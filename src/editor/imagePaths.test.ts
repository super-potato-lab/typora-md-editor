import assert from "node:assert/strict";
import { test } from "node:test";
import { localImageSrc, resolveLocalImagePath, rewriteImgSrcs } from "./imagePaths.ts";

test("joins a relative image to the document directory", () => {
  assert.equal(resolveLocalImagePath("assets/a.png", "/docs"), "/docs/assets/a.png");
  assert.equal(resolveLocalImagePath("assets/a.png", "/docs/"), "/docs/assets/a.png");
  assert.equal(resolveLocalImagePath("assets/a.png", "C:\\docs"), "C:\\docs\\assets\\a.png");
});

test("leaves remote and absolute image paths alone", () => {
  assert.equal(resolveLocalImagePath("https://cdn.example/a.png", "/docs"), null);
  assert.equal(resolveLocalImagePath("/pics/a.png", "/docs"), "/pics/a.png");
  assert.equal(resolveLocalImagePath("assets/a.png", null), null);
});

test("print html points local images at asset urls from the document directory", () => {
  const html = rewriteImgSrcs(
    '<p><img alt="a" src="assets/a.png"><img src="https://cdn.example/a.png"><img srcset="assets/srcset.png" src="assets/b.png"></p>',
    (src) => localImageSrc(src, "/docs", (absolute) => `asset://localhost${absolute}`),
  );
  assert.equal(
    html,
    '<p><img alt="a" src="asset://localhost/docs/assets/a.png"><img src="https://cdn.example/a.png"><img srcset="assets/srcset.png" src="asset://localhost/docs/assets/b.png"></p>',
  );
});

test("decodes attribute entities before mapping a print src", () => {
  let seen = "";
  const html = rewriteImgSrcs('<img src="assets/a&amp;b.png">', (src) => {
    seen = src;
    return "asset://x&y";
  });
  assert.equal(seen, "assets/a&b.png");
  assert.equal(html, '<img src="asset://x&amp;y">');
});

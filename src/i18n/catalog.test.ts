import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeError } from "./errors.ts";
import { getLocale, setLocale, t } from "./locale.ts";
import { en, zhCN, type MessageKey } from "./messages.ts";

test("zh-CN and en catalogs share every key", () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zhCN).sort();
  assert.deepEqual(zhKeys, enKeys);
  for (const key of enKeys) {
    assert.equal(typeof zhCN[key as MessageKey], "string");
    assert.ok(zhCN[key as MessageKey].length > 0);
  }
});

test("defaults to zh-CN and switches both ways", () => {
  setLocale("zh-CN");
  assert.equal(getLocale(), "zh-CN");
  assert.equal(t("menu.file"), "文件");
  assert.equal(t("doc.untitled"), "未命名");
  assert.equal(t("window.title", { dirty: "• ", name: "未命名", app: t("app.name") }), "• 未命名 — Markdown 编辑器");
  setLocale("en");
  assert.equal(getLocale(), "en");
  assert.equal(t("menu.file"), "File");
  assert.equal(t("status.words.other", { count: 3 }), "3 words");
  setLocale("zh-CN");
});

test("localizes known editor errors and leaves system text", () => {
  setLocale("zh-CN");
  assert.equal(
    localizeError("Save the document before inserting an image."),
    "插入图片前请先保存文档。",
  );
  assert.equal(localizeError("unsupported image type .txt"), "不支持的图片类型 .txt");
  assert.equal(
    localizeError("Could not copy C:\\docs\\a.png: No such file (os error 2)"),
    "无法复制 C:\\docs\\a.png：No such file (os error 2)",
  );
  assert.equal(localizeError("No such file or directory (os error 2)"), "No such file or directory (os error 2)");
  setLocale("en");
  assert.equal(
    localizeError(new Error("Could not open the print view.")),
    "Could not open the print view.",
  );
  setLocale("zh-CN");
});

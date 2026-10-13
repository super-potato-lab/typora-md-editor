import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readConfiguredVersion, resolveReleaseTag } from "./resolve-release-tag.mjs";

const script = fileURLToPath(new URL("./resolve-release-tag.mjs", import.meta.url));

test("a version tag push keeps that tag", () => {
  assert.deepEqual(
    resolveReleaseTag({ refType: "tag", refName: "v0.2.0", versionInput: "9.9.9", configuredVersion: "0.1.0" }),
    { tag: "v0.2.0", version: "0.2.0" },
  );
});

test("manual dispatch defaults to the configured version", () => {
  assert.deepEqual(
    resolveReleaseTag({ refType: "branch", refName: "main", versionInput: "", configuredVersion: "0.1.0" }),
    { tag: "v0.1.0", version: "0.1.0" },
  );
  assert.deepEqual(
    resolveReleaseTag({ refType: "branch", refName: "main", versionInput: "  ", configuredVersion: "v0.1.0" }),
    { tag: "v0.1.0", version: "0.1.0" },
  );
});

test("manual dispatch accepts 0.2.0 and v0.2.0", () => {
  assert.deepEqual(
    resolveReleaseTag({ refType: "branch", refName: "main", versionInput: "0.2.0", configuredVersion: "0.1.0" }),
    { tag: "v0.2.0", version: "0.2.0" },
  );
  assert.deepEqual(
    resolveReleaseTag({ refType: "branch", refName: "main", versionInput: "V0.2.0-rc.1", configuredVersion: "0.1.0" }),
    { tag: "v0.2.0-rc.1", version: "0.2.0-rc.1" },
  );
});

test("rejects versions that are not tags", () => {
  assert.throws(
    () => resolveReleaseTag({ refType: "branch", refName: "main", versionInput: "latest", configuredVersion: "0.1.0" }),
    /Version must look like 0\.1\.0/,
  );
  assert.throws(
    () => resolveReleaseTag({ refType: "tag", refName: "nightly", configuredVersion: "0.1.0" }),
    /Tag push must be a version tag/,
  );
});

test("configured version prefers tauri.conf.json, then package.json", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-tag-"));
  try {
    await mkdir(path.join(root, "src-tauri"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.4.0" }));
    await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "0.3.0" }));
    assert.equal(readConfiguredVersion(root), "0.3.0");

    await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), "{}");
    assert.equal(readConfiguredVersion(root), "0.4.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI prints the repo version when the dispatch input is empty", () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: path.resolve(path.dirname(script), ".."),
    env: { ...process.env, RELEASE_REF_TYPE: "branch", RELEASE_REF_NAME: "main", RELEASE_VERSION_INPUT: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { tag: "v0.1.0", version: "0.1.0" });
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { githubAssetName, selectLinuxBundles, stageLinuxReleaseAssets } from "./linux-release-assets.mjs";

const script = fileURLToPath(new URL("./linux-release-assets.mjs", import.meta.url));
const workflow = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

test("release asset names match tauri-action's dot rule", () => {
  assert.equal(
    githubAssetName("Markdown Editor_0.1.0_amd64.deb"),
    "Markdown.Editor_0.1.0_amd64.deb",
  );
  assert.equal(
    githubAssetName("Markdown Editor_0.1.0_amd64.AppImage"),
    "Markdown.Editor_0.1.0_amd64.AppImage",
  );
  assert.equal(githubAssetName("markdown-editor_0.1.0_amd64.deb"), "markdown-editor_0.1.0_amd64.deb");
});

test("selects the deb and AppImage and ignores updater files", () => {
  const selected = selectLinuxBundles([
    "/bundle/deb/Markdown Editor_0.1.0_amd64.deb",
    "/bundle/deb/Markdown Editor_0.1.0_amd64.deb.sig",
    "/bundle/appimage/Markdown Editor_0.1.0_amd64.AppImage",
    "/bundle/appimage/Markdown Editor_0.1.0_amd64.AppImage.sig",
    "/bundle/appimage/Markdown Editor_0.1.0_amd64.AppImage.tar.gz",
  ]);
  assert.deepEqual(selected, {
    deb: "/bundle/deb/Markdown Editor_0.1.0_amd64.deb",
    appImage: "/bundle/appimage/Markdown Editor_0.1.0_amd64.AppImage",
  });
});

test("rejects a bundle set that is missing a format", () => {
  assert.throws(
    () => selectLinuxBundles(["/bundle/deb/app_0.1.0_amd64.deb"]),
    /Expected one \.deb and one \.AppImage/,
  );
});

test("copies both bundles under the release asset names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linux-assets-"));
  try {
    const deb = path.join(root, "Markdown Editor_0.1.0_amd64.deb");
    const appImage = path.join(root, "Markdown Editor_0.1.0_amd64.AppImage");
    await writeFile(deb, "deb");
    await writeFile(appImage, "appimage");
    const outDir = path.join(root, "out");
    const written = await stageLinuxReleaseAssets({ paths: [deb, appImage], outDir });
    assert.deepEqual(
      written.map((file) => path.basename(file)),
      ["Markdown.Editor_0.1.0_amd64.deb", "Markdown.Editor_0.1.0_amd64.AppImage"],
    );
    assert.equal(await readFile(written[0], "utf8"), "deb");
    assert.equal(await readFile(written[1], "utf8"), "appimage");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI prints the staged paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linux-assets-cli-"));
  try {
    const deb = path.join(root, "Markdown Editor_0.1.0_amd64.deb");
    const appImage = path.join(root, "Markdown Editor_0.1.0_amd64.AppImage");
    await writeFile(deb, "deb");
    await writeFile(appImage, "appimage");
    const outDir = path.join(root, "out");
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        ARTIFACT_PATHS: JSON.stringify([deb, appImage, `${appImage}.sig`]),
        LINUX_ASSET_DIR: outDir,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").map((file) => path.basename(file)), [
      "Markdown.Editor_0.1.0_amd64.deb",
      "Markdown.Editor_0.1.0_amd64.AppImage",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the release workflow keeps Windows and adds ubuntu-latest AppImage and deb", async () => {
  const yml = await readFile(workflow, "utf8");
  assert.match(yml, /runs-on: windows-latest/);
  assert.match(yml, /runs-on: ubuntu-latest/);
  assert.match(yml, /--bundles nsis,msi/);
  assert.match(yml, /--bundles appimage,deb/);
  assert.match(yml, /package-windows-portable\.mjs/);
  assert.match(yml, /windows-x64-portable/);
  assert.match(yml, /gh release upload/);
  assert.match(yml, /linux-x64-bundles/);
  assert.match(yml, /NO_STRIP/);
  assert.match(yml, /APPIMAGE_EXTRACT_AND_RUN/);
});

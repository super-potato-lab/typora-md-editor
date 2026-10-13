import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { packagePortable } from "./package-windows-portable.mjs";

const inflate = promisify(inflateRaw);

test("portable zip contains the exe, runtime dlls, and resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portable-"));
  try {
    const releaseDir = path.join(root, "release");
    const configPath = path.join(root, "tauri.conf.json");
    await mkdir(path.join(releaseDir, "resources", "icons"), { recursive: true });
    await mkdir(path.join(releaseDir, "deps"), { recursive: true });
    await writeFile(configPath, JSON.stringify({ productName: "Markdown Editor", version: "0.1.0" }));
    await writeFile(path.join(releaseDir, "Markdown Editor.exe"), "exe-bytes");
    await writeFile(path.join(releaseDir, "WebView2Loader.dll"), "loader");
    await writeFile(path.join(releaseDir, "markdown_editor_lib.dll"), "not-shipped");
    await writeFile(path.join(releaseDir, "Markdown Editor.pdb"), "symbols");
    await writeFile(path.join(releaseDir, "deps", "vcruntime140.dll"), "wrong-place");
    await writeFile(path.join(releaseDir, "resources", "icons", "icon.png"), "png");

    const zipPath = await packagePortable({ releaseDir, configPath, arch: "x64" });
    assert.equal(path.basename(zipPath), "Markdown-Editor_0.1.0_x64-portable.zip");

    const entries = await unzip(await readFile(zipPath));
    assert.deepEqual(Object.keys(entries).sort(), [
      "Markdown Editor/Markdown Editor.exe",
      "Markdown Editor/README.txt",
      "Markdown Editor/WebView2Loader.dll",
      "Markdown Editor/resources/icons/icon.png",
    ]);
    assert.equal(entries["Markdown Editor/Markdown Editor.exe"].toString(), "exe-bytes");
    assert.equal(entries["Markdown Editor/resources/icons/icon.png"].toString(), "png");
    assert.match(entries["Markdown Editor/README.txt"].toString("utf8"), /Nothing is installed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executable fails before writing a zip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portable-missing-"));
  try {
    const releaseDir = path.join(root, "release");
    await mkdir(releaseDir);
    const configPath = path.join(root, "tauri.conf.json");
    await writeFile(configPath, JSON.stringify({ productName: "Markdown Editor", version: "0.1.0" }));
    await assert.rejects(
      packagePortable({ releaseDir, configPath, outPath: path.join(root, "out.zip") }),
      /could not find the Windows executable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finds the Cargo package exe under a Windows target triple", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portable-triple-"));
  try {
    const tauriDir = path.join(root, "src-tauri");
    const releaseDir = path.join(tauriDir, "target", "x86_64-pc-windows-msvc", "release");
    const nsisDir = path.join(tauriDir, "target", "release", "bundle", "nsis");
    await mkdir(path.join(releaseDir, "resources"), { recursive: true });
    await mkdir(nsisDir, { recursive: true });
    await writeFile(
      path.join(tauriDir, "tauri.conf.json"),
      JSON.stringify({ productName: "Markdown Editor", version: "0.1.0" }),
    );
    await writeFile(path.join(tauriDir, "Cargo.toml"), '[package]\nname = "markdown-editor"\nversion = "0.1.0"\n');
    await writeFile(path.join(releaseDir, "markdown-editor.exe"), "real-exe");
    await writeFile(path.join(releaseDir, "WebView2Loader.dll"), "loader");
    await writeFile(path.join(nsisDir, "Markdown Editor_0.1.0_x64-setup.exe"), "installer");

    const zipPath = await packagePortable({ projectRoot: root, arch: "x64" });
    const entries = await unzip(await readFile(zipPath));
    assert.equal(entries["Markdown Editor/markdown-editor.exe"].toString(), "real-exe");
    assert.equal(entries["Markdown Editor/WebView2Loader.dll"].toString(), "loader");
    assert.match(entries["Markdown Editor/README.txt"].toString("utf8"), /markdown-editor\.exe/);
    assert.equal(entries["Markdown Editor/Markdown Editor_0.1.0_x64-setup.exe"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not zip an NSIS setup when the app executable is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "portable-setup-only-"));
  try {
    const tauriDir = path.join(root, "src-tauri");
    const nsisDir = path.join(tauriDir, "target", "release", "bundle", "nsis");
    await mkdir(nsisDir, { recursive: true });
    await writeFile(
      path.join(tauriDir, "tauri.conf.json"),
      JSON.stringify({ productName: "Markdown Editor", version: "0.1.0" }),
    );
    await writeFile(path.join(tauriDir, "Cargo.toml"), '[package]\nname = "markdown-editor"\nversion = "0.1.0"\n');
    await writeFile(path.join(nsisDir, "Markdown Editor_0.1.0_x64-setup.exe"), "installer");
    await assert.rejects(
      packagePortable({ projectRoot: root, outPath: path.join(root, "out.zip") }),
      /could not find the Windows executable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function unzip(buffer) {
  const entries = {};
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries[name] = method === 0 ? Buffer.from(compressed) : await inflate(compressed);
    offset = dataStart + compressedSize;
  }
  return entries;
}

/**
 * Stage the Linux bundles Tauri wrote so they can sit on a GitHub Release
 * next to the Windows assets.
 *
 * Tauri names files from productName (`Markdown Editor_0.1.0_amd64.deb`).
 * tauri-action turns characters other than letters, digits, `_`, and `-`
 * into dots before upload (`Markdown.Editor_0.1.0_x64-setup.exe`). This uses
 * that same rule. Only the `.deb` and `.AppImage` are copied. Updater
 * signatures and `.tar.gz` archives are left out.
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function githubAssetName(filename) {
  return String(filename)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, ".")
    .replace(/\.\./g, ".");
}

export function selectLinuxBundles(paths) {
  const files = (Array.isArray(paths) ? paths : []).filter(
    (entry) => typeof entry === "string" && (entry.endsWith(".deb") || entry.endsWith(".AppImage")),
  );
  const deb = files.filter((entry) => entry.endsWith(".deb"));
  const appImage = files.filter((entry) => entry.endsWith(".AppImage"));
  if (deb.length !== 1 || appImage.length !== 1) {
    throw new Error(
      `Expected one .deb and one .AppImage, found deb=${deb.length} AppImage=${appImage.length}: ${JSON.stringify(paths)}`,
    );
  }
  return { deb: deb[0], appImage: appImage[0] };
}

export async function stageLinuxReleaseAssets({ paths, outDir }) {
  const selected = selectLinuxBundles(paths);
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const source of [selected.deb, selected.appImage]) {
    const dest = path.join(outDir, githubAssetName(path.basename(source)));
    await copyFile(source, dest);
    written.push(path.resolve(dest));
  }
  return written;
}

async function main() {
  const raw = process.env.ARTIFACT_PATHS;
  if (!raw || !raw.trim()) {
    throw new Error("ARTIFACT_PATHS is empty");
  }
  const written = await stageLinuxReleaseAssets({
    paths: JSON.parse(raw),
    outDir: process.env.LINUX_ASSET_DIR || "linux-release-assets",
  });
  process.stdout.write(`${written.join("\n")}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

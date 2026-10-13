/**
 * Pick the Git tag for a Windows release.
 *
 * A `v*` tag push uses that tag. A manual workflow_dispatch uses the Version
 * input, or `version` from tauri.conf.json, then package.json. `0.1.0` and
 * `v0.1.0` both become the tag `v0.1.0`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function resolveReleaseTag({ refType, refName, versionInput, configuredVersion }) {
  if (refType === "tag") {
    const tag = String(refName ?? "").trim();
    if (!tag.startsWith("v") || !VERSION.test(tag.slice(1))) {
      throw new Error(`Tag push must be a version tag such as v0.1.0, got: ${tag || "(empty)"}`);
    }
    return { tag, version: tag.slice(1) };
  }

  const raw = String(versionInput ?? "").trim() || String(configuredVersion ?? "").trim();
  const version = raw.replace(/^v/i, "");
  if (!VERSION.test(version)) {
    throw new Error(`Version must look like 0.1.0, got: ${raw || "(empty)"}`);
  }
  return { tag: `v${version}`, version };
}

export function readConfiguredVersion(root) {
  const tauriPath = path.join(root, "src-tauri", "tauri.conf.json");
  const packagePath = path.join(root, "package.json");
  const tauriVersion = readJson(tauriPath).version;
  if (typeof tauriVersion === "string" && tauriVersion.trim()) return tauriVersion.trim();
  const packageVersion = readJson(packagePath).version;
  if (typeof packageVersion === "string" && packageVersion.trim()) return packageVersion.trim();
  throw new Error(`${tauriPath} and ${packagePath} have no version`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

function main() {
  const { values } = parseArgs({
    options: { root: { type: "string", default: process.cwd() } },
  });
  const resolved = resolveReleaseTag({
    refType: process.env.RELEASE_REF_TYPE,
    refName: process.env.RELEASE_REF_NAME,
    versionInput: process.env.RELEASE_VERSION_INPUT,
    configuredVersion: readConfiguredVersion(values.root),
  });
  process.stdout.write(`${JSON.stringify(resolved)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

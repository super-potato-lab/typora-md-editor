/**
 * Zip a no-install Windows build of the editor.
 *
 * Tauri 2.12 has no portable bundle target. Windows bundles are NSIS and MSI
 * only. This script packs the same files an NSIS install copies next to the
 * executable: the release .exe, WebView2Loader.dll when the gnu toolchain
 * emitted it, Visual C++ runtime DLLs when they sit beside the exe, and the
 * `resources/` directory when the build produced one.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const deflate = promisify(deflateRaw);

/** DLLs the NSIS bundler may place beside the exe. The cdylib is not one of them. */
const RUNTIME_DLLS = new Set(
  [
    "WebView2Loader.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "msvcp140_codecvt_ids.dll",
    "concrt140.dll",
    "vccorlib140.dll",
  ].map((name) => name.toLowerCase()),
);

const ARCH = { x64: "x64", arm64: "arm64", ia32: "x86" };

const HOST_TRIPLES = [
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "i686-pc-windows-msvc",
];

export async function packagePortable({
  releaseDir,
  configPath,
  outPath,
  arch = process.arch,
  projectRoot = process.cwd(),
  cargoTargetDir = process.env.CARGO_TARGET_DIR,
} = {}) {
  const located = await locateWindowsExecutable({
    projectRoot,
    releaseDir,
    configPath,
    cargoTargetDir,
  });
  const { productName, version, exePath, exeName } = located;
  const root = located.releaseDir;

  const folder = productName;
  const files = [{ source: exePath, name: `${folder}/${exeName}` }];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !RUNTIME_DLLS.has(entry.name.toLowerCase())) continue;
    files.push({
      source: path.join(root, entry.name),
      name: `${folder}/${entry.name}`,
    });
  }

  const resourcesDir = path.join(root, "resources");
  if (await isDirectory(resourcesDir)) {
    await collectFiles(resourcesDir, `${folder}/resources`, files);
  }

  files.push({
    source: null,
    name: `${folder}/README.txt`,
    data: Buffer.from(portableReadme(productName, exeName), "utf8"),
  });

  const bundleArch = ARCH[arch] ?? arch;
  const zipName = `${slug(productName)}_${version}_${bundleArch}-portable.zip`;
  const destination =
    outPath ?? path.join(root, "bundle", "portable", zipName);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await zipFiles(files));
  return path.resolve(destination);
}

/**
 * Tauri writes `markdown-editor.exe` (the Cargo package name) into
 * `src-tauri/target/release`, not `Markdown Editor.exe` (productName).
 * A `--target` build nests that folder under the triple. NSIS/MSI outputs
 * stay in `bundle/` and are not the portable executable.
 */
export async function locateWindowsExecutable({
  projectRoot = process.cwd(),
  releaseDir,
  configPath,
  cargoTargetDir = process.env.CARGO_TARGET_DIR,
} = {}) {
  const configFile = path.resolve(projectRoot, configPath ?? path.join("src-tauri", "tauri.conf.json"));
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const productName = config.productName;
  const version = config.version;
  if (!productName || !version) {
    throw new Error(`${configFile} is missing productName or version`);
  }

  const packageName = await readCargoPackageName(path.join(path.dirname(configFile), "Cargo.toml"));
  const names = unique(
    [exeFileName(config.mainBinaryName), exeFileName(packageName), exeFileName(productName)].filter(
      Boolean,
    ),
  );
  const dirs = releaseDirectories({ projectRoot, releaseDir, cargoTargetDir });

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await isFile(candidate)) {
        return { exePath: candidate, exeName: name, releaseDir: dir, productName, version };
      }
    }
    const loose = await loneReleaseExe(dir);
    if (loose) {
      return {
        exePath: loose,
        exeName: path.basename(loose),
        releaseDir: dir,
        productName,
        version,
      };
    }
  }

  const lookedFor = names.length > 0 ? names.join(", ") : "a release .exe";
  throw new Error(
    [
      "Portable build could not find the Windows executable.",
      `Looked for ${lookedFor} in:`,
      ...dirs.map((dir) => `- ${dir}`),
      "Run `npm run tauri build` on Windows first.",
    ].join("\n"),
  );
}

function releaseDirectories({ projectRoot, releaseDir, cargoTargetDir }) {
  if (releaseDir) return [path.resolve(releaseDir)];
  const roots = [];
  if (cargoTargetDir) roots.push(path.resolve(cargoTargetDir));
  roots.push(path.resolve(projectRoot, "src-tauri", "target"));
  roots.push(path.resolve(projectRoot, "target"));
  const dirs = [];
  for (const root of roots) {
    dirs.push(path.join(root, "release"));
    for (const triple of HOST_TRIPLES) {
      dirs.push(path.join(root, triple, "release"));
    }
    dirs.push(path.join(root, "release", "bundle", "nsis"));
    for (const triple of HOST_TRIPLES) {
      dirs.push(path.join(root, triple, "release", "bundle", "nsis"));
    }
  }
  return unique(dirs);
}

function exeFileName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith(".exe") ? trimmed : `${trimmed}.exe`;
}

async function readCargoPackageName(cargoTomlPath) {
  let text;
  try {
    text = await readFile(cargoTomlPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  const section = text.split(/\n(?=\[)/).find((part) => part.startsWith("[package]"));
  const match = section?.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

async function loneReleaseExe(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  const exes = entries
    .filter((entry) => entry.isFile() && isAppExe(entry.name))
    .map((entry) => path.join(directory, entry.name));
  return exes.length === 1 ? exes[0] : null;
}

function isAppExe(name) {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".exe")) return false;
  if (lower.endsWith("-setup.exe") || lower === "uninstall.exe") return false;
  return true;
}

function unique(values) {
  return [...new Set(values)];
}

function portableReadme(productName, exeName) {
  return [
    `${productName} (portable)`,
    "",
    `Unzip this folder and run "${exeName}". Nothing is installed.`,
    "Windows 10 or 11 with the WebView2 runtime is required. Windows 11 includes it.",
    "This build is unsigned, so SmartScreen may warn before it starts.",
    "Settings stay in your user profile, the same place as an installed copy.",
    "",
  ].join("\r\n");
}

function slug(productName) {
  return productName.trim().replace(/\s+/g, "-");
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function collectFiles(directory, prefix, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFiles(source, name, files);
    } else if (entry.isFile()) {
      files.push({ source, name });
    }
  }
}

async function zipFiles(files) {
  const now = new Date();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = file.data ?? (await readFile(file.source));
    const compressed = await deflate(data);
    const store = compressed.length >= data.length;
    const payload = store ? data : compressed;
    const method = store ? 0 : 8;
    const name = Buffer.from(file.name.replaceAll("\\", "/"), "utf8");
    const crc = crc32(data);
    const local = localHeader({ name, crc, method, payload, data, now });
    locals.push(local, payload);
    central.push(centralHeader({ name, crc, method, payload, data, now, offset }));
    offset += local.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = endOfCentralDirectory(central.length, centralBuf.length, offset);
  return Buffer.concat([...locals, centralBuf, end]);
}

function localHeader({ name, crc, method, payload, data, now }) {
  const { time, date } = dosDateTime(now);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader({ name, crc, method, payload, data, now, offset }) {
  const { time, date } = dosDateTime(now);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(payload.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(count, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "release-dir": { type: "string" },
      config: { type: "string" },
      out: { type: "string" },
    },
  });
  const zip = await packagePortable({
    releaseDir: values["release-dir"],
    configPath: values.config,
    outPath: values.out,
  });
  process.stdout.write(`${zip}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

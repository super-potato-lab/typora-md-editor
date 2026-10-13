# Markdown Editor

A desktop Markdown editor: one window, TipTap live editing, Markdown on disk, and CSS themes for the document.

There is no account, license check, or activation step.

## Run

Requirements: Node.js 22+, Rust 1.90+ (Tauri 2.12), and the usual Tauri system libraries.

On Ubuntu / Debian:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential
```

Then:

```bash
npm install
npm run tauri dev
```

That starts Vite on port 1420 and opens the Tauri window.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend only (open/save dialogs need the Tauri window) |
| `npm run build` | Typecheck and bundle the frontend to `dist/` |
| `npm run tauri build` | Production bundle for the current operating system |
| `node scripts/package-windows-portable.mjs` | After a Windows `tauri build`, zip the no-install executable |
| `node --test scripts/package-windows-portable.test.mjs` | Checks that portable zip layout |
| `node --test scripts/resolve-release-tag.test.mjs` | Checks which tag a release run publishes |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust unit tests |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust compile check |

`npm run tauri build` still builds whatever OS you are on. The GitHub workflow below builds Windows installers and a Windows portable zip only.

## Use

- **File → Open…** (`Ctrl/Cmd+O`) opens a `.md` or `.markdown` file.
- **File → Save** (`Ctrl/Cmd+S`) writes the current path, or asks for one if the document is still untitled.
- **File → Save As…** (`Ctrl/Cmd+Shift+S`) always asks for a path. A name without an extension is saved as `.md`.
- **File → Insert Image…**, or paste / drop an image. The file is copied into an `assets/` folder next to the Markdown file, and the document gets a relative image link such as `![diagram](assets/diagram.png)`. Save the document before inserting an image.
- **File → Export HTML…** writes a standalone HTML file that includes the active theme. Image links stay relative, so keep the HTML next to the Markdown file and its `assets/` folder.
- **File → Export PDF…** opens the system print dialog on a theme-styled copy of the document. Choose **Save as PDF** (or Microsoft Print to PDF). There is no bundled PDF engine.
- **Edit → Find / Replace** (`Ctrl/Cmd+F`, `Ctrl/Cmd+H`) searches the document text. Enter jumps to the next match, Shift+Enter to the previous one.
- **Format → Bold / Italic / Code** (`Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+E`) toggles those TipTap marks. The same shortcuts work while the editor is focused.
- **View → Outline** shows or hides the heading list. Click a heading to scroll to it. The same sidebar lists recent files.
- **Theme** switches the document skin. The choice is stored in `localStorage`.
- The window title shows the full path and a dirty marker. The status bar shows the word count, character count, and path.

Closing the window asks before discarding unsaved edits.

## Windows downloads

GitHub Actions builds **unsigned Windows artifacts only**: an NSIS setup, an MSI installer, and a portable zip. Linux and macOS bundles are not produced in CI.

Tauri 2.12 has no portable bundle target (`nsis` and `msi` are the Windows formats). The portable zip is the release executable those installers copy to disk (`markdown-editor.exe`, the Cargo package name), plus `WebView2Loader.dll` or Visual C++ runtime DLLs when the build actually produced them, and a `resources/` folder when the app bundles resources. [`.github/workflows/release.yml`](.github/workflows/release.yml) runs `tauri-apps/tauri-action@v1` on `windows-latest` with `--bundles nsis,msi`, then `scripts/package-windows-portable.mjs`.

| Download | What you do | What it changes on the PC |
| --- | --- | --- |
| `*-setup.exe` (NSIS) | Run the setup | Installs the app, Start menu shortcut, uninstaller. Can download the WebView2 bootstrapper if that runtime is missing. |
| `*.msi` (WiX) | Run the installer | Same kind of installed app, in the Windows Installer format. |
| `*-portable.zip` | Unzip and run `markdown-editor.exe` | No setup, no Start menu entry, no uninstaller. Delete the folder to remove the program files. Does not install WebView2. |

Windows 11 already includes WebView2. On Windows 10, install that runtime before using the portable zip. The portable copy is the same executable as the installers, so settings stay in your user profile rather than in the unzipped folder. Both are unsigned, so SmartScreen may warn.

Either of these puts the setup `.exe`, the `.msi`, and `Markdown-Editor_<version>_x64-portable.zip` on the [GitHub Releases](https://github.com/super-potato-lab/typora-md-editor/releases) page. Both also upload workflow artifacts.

**Push a version tag.** The tag name is the release.

```bash
git tag v0.2.0
git push origin v0.2.0
```

**Run workflow** from the Actions tab. Leave **Version** empty to read `version` from `src-tauri/tauri.conf.json` (and from `package.json` if that field is empty). `0.1.0` becomes the tag `v0.1.0`. Type `0.2.0` or `v0.2.0` to publish a different tag. The run creates the tag when it is missing, creates or updates the Release for that tag, and uploads the three Windows files as release assets. Running the same version again replaces those assets.

No signing secrets are required. `GITHUB_TOKEN` is the token Actions provides for the repository. You do not add a secret to build or publish these unsigned files.

To make the zip locally after a Windows production build:

```bash
npm run tauri build
node scripts/package-windows-portable.mjs
```

## Structure

```
index.html              Vite entry
src/                    React UI
  App.tsx               Menus, find bar, status bar
  chrome/               Outline sidebar, find bar, menus
  editor/               TipTap editor, find/replace, HTML export
  files.ts              Tauri invoke wrappers
  recent.ts             Recent-file list in localStorage
  themes.ts             Loads every CSS file in themes/ and swaps #theme_css
  styles/               Chrome layout and base document rules
themes/                 Document themes. Drop in another lowercase .css file to list it.
  github.css            Light default
  night.css             Dark
src-tauri/              Tauri 2 shell
  src/lib.rs            Open/save, image assets, HTML export
  capabilities/         Window permissions
scripts/                Portable Windows zip and release tag
.github/workflows/      Windows installer and portable zip workflow
```

Themes style the rendered document (`#write`) and a few chrome variables (`--bg-color`, `--text-color`, `--chrome-bg`, …). They are plain CSS. The active sheet is a `<link id="theme_css">` appended after the app styles.

## Deferred

- Code signing and notarization.
- Linux and macOS CI bundles. Build those locally with `npm run tauri build`.
- A bundled PDF renderer. PDF export uses the operating system's print dialog.
- Multiple document tabs. Recent files plus one editor cover that job without a tab strip.

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
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust unit tests |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust compile check |

`npm run tauri build` still builds whatever OS you are on. The GitHub workflow below builds Windows installers only.

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

## Windows installers

GitHub Actions builds **unsigned Windows NSIS and MSI installers only**. Linux and macOS bundles are not produced in CI.

Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml). It uses `tauri-apps/tauri-action@v1` on `windows-latest` with `--bundles nsis,msi`.

Trigger it by pushing a version tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

That tag run builds the installers, uploads them as workflow artifacts, and creates a GitHub Release named after the tag with the `.exe` and `.msi` attached.

You can also run the workflow manually from the Actions tab (**Run workflow**). A manual run uploads the same Windows artifacts and does not create a release.

No signing secrets are required. The installers are unsigned, so Windows SmartScreen may warn before launch. Adding a certificate is an optional follow-up; it is not part of this workflow.

`GITHUB_TOKEN` is the token Actions provides for the repository. You do not add a secret to build or publish these unsigned installers.

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
.github/workflows/      Windows installer workflow
```

Themes style the rendered document (`#write`) and a few chrome variables (`--bg-color`, `--text-color`, `--chrome-bg`, …). They are plain CSS. The active sheet is a `<link id="theme_css">` appended after the app styles.

## Deferred

- Code signing and notarization.
- Linux and macOS CI bundles. Build those locally with `npm run tauri build`.
- A bundled PDF renderer. PDF export uses the operating system's print dialog.
- Multiple document tabs. Recent files plus one editor cover that job without a tab strip.

# Markdown Editor

A small desktop Markdown editor: one window, TipTap live editing, Markdown on disk, and CSS themes for the document.

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
| `npm run tauri build` | Production desktop bundle |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust unit tests |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust compile check |

## Use

- **File → Open…** (`Ctrl/Cmd+O`) opens a `.md` or `.markdown` file through the native dialog.
- **File → Save** (`Ctrl/Cmd+S`) writes the current path, or asks for one if the document is still untitled.
- **File → Save As…** (`Ctrl/Cmd+Shift+S`) always asks for a path. A name without an extension is saved as `.md`.
- **Theme** switches the document skin. The choice is stored in `localStorage`.
- Typing uses TipTap’s Markdown shortcuts (`# `, `**bold**`, lists, fences, task lists). The file is read and written as Markdown (`editor.getMarkdown()` / `setContent` with `contentType: "markdown"`).

Closing the window asks before discarding unsaved edits.

## Structure

```
index.html              Vite entry
src/                    React UI
  App.tsx               File / Theme chrome
  editor/               TipTap editor and welcome document
  files.ts              Tauri invoke wrappers for open/save
  themes.ts             Loads every CSS file in themes/ and swaps #theme_css
  styles/               Chrome layout and base document rules (CSS variables)
themes/                 Document themes. Drop in another lowercase .css file to list it.
  github.css            Light default
  night.css             Dark
src-tauri/              Tauri 2 shell
  src/lib.rs            Native open/save dialogs and filesystem read/write
  capabilities/         Window permissions
```

Themes style the rendered document (`#write`) and a few chrome variables (`--bg-color`, `--text-color`, `--chrome-bg`, …). They are plain CSS. The active sheet is a `<link id="theme_css">` appended after the app styles, so a theme overrides the defaults without replacing the editor.

## Out of scope

This scaffold stops at editing, open/save, and theme switching. It does not include export, a file sidebar, spellcheck dictionaries, or diagram blocks.

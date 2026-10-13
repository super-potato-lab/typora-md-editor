import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import {
  basename,
  errorMessage,
  isTauri,
  openMarkdownFile,
  saveMarkdownFile,
  saveMarkdownFileAs,
} from "./files";
import { applyTheme, readSavedTheme, themes } from "./themes";

interface Status {
  kind: "info" | "error";
  text: string;
}

function shortcutLabel(key: string): string {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return `${mod}+${key}`;
}

export function App() {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const dirtyRef = useRef(false);
  const pathRef = useRef<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [theme, setTheme] = useState(readSavedTheme);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  useEffect(() => {
    const name = path ? basename(path) : "Untitled";
    const title = `${dirty ? "• " : ""}${name} — Markdown Editor`;
    document.title = title;
    if (!isTauri()) return;
    void getCurrentWindow().setTitle(title).catch(() => {
      /* title is cosmetic */
    });
  }, [path, dirty]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (dirtyRef.current && !window.confirm("Discard unsaved changes?")) {
          event.preventDefault();
        }
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        /* close confirmation is optional if the event is unavailable */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const chooseTheme = useCallback((id: string) => {
    setTheme(applyTheme(id));
    setStatus(null);
  }, []);

  const openFile = useCallback(async () => {
    if (dirtyRef.current && !window.confirm("Discard unsaved changes?")) return;
    try {
      const opened = await openMarkdownFile();
      if (!opened) return;
      editorRef.current?.setMarkdown(opened.content);
      setPath(opened.path);
      setStatus({ kind: "info", text: "Opened" });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }, []);

  const saveAs = useCallback(async () => {
    try {
      const content = editorRef.current?.getMarkdown() ?? "";
      const suggested = pathRef.current ? basename(pathRef.current) : "Untitled.md";
      const saved = await saveMarkdownFileAs(content, suggested);
      if (!saved) return;
      setPath(saved);
      editorRef.current?.markSaved();
      setStatus({ kind: "info", text: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }, []);

  const save = useCallback(async () => {
    const current = pathRef.current;
    if (!current) {
      await saveAs();
      return;
    }
    try {
      const content = editorRef.current?.getMarkdown() ?? "";
      await saveMarkdownFile(current, content);
      editorRef.current?.markSaved();
      setStatus({ kind: "info", text: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }, [saveAs]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAs();
      } else if (key === "s") {
        event.preventDefault();
        void save();
      } else if (key === "o") {
        event.preventDefault();
        void openFile();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFile, save, saveAs]);

  const docName = path ? basename(path) : "Untitled";

  return (
    <div className="app">
      <header className="chrome">
        <nav className="menus" aria-label="Editor">
          <Menu label="File">
            <MenuItem label="Open…" hint={shortcutLabel("O")} onSelect={() => void openFile()} />
            <MenuItem label="Save" hint={shortcutLabel("S")} onSelect={() => void save()} />
            <MenuItem
              label="Save As…"
              hint={shortcutLabel("⇧S")}
              onSelect={() => void saveAs()}
            />
          </Menu>
          <Menu label="Theme">
            {themes.map((item) => (
              <MenuItem
                key={item.id}
                label={item.label}
                checked={item.id === theme}
                onSelect={() => chooseTheme(item.id)}
              />
            ))}
          </Menu>
        </nav>
        <div className="chrome-meta">
          {status && (
            <span className={status.kind === "error" ? "status error" : "status"} role="status">
              {status.text}
            </span>
          )}
          <span className="doc-name" title={path ?? "Untitled"}>
            {dirty ? "• " : ""}
            {docName}
          </span>
        </div>
      </header>
      <div
        className="editor-scroll"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            editorRef.current?.focus();
          }
        }}
      >
        <MarkdownEditor ref={editorRef} onDirtyChange={setDirty} />
      </div>
    </div>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-panel" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  checked,
  onSelect,
}: {
  label: string;
  hint?: string;
  checked?: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={onSelect}>
      <span>
        {checked ? "✓ " : ""}
        {label}
      </span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  );
}

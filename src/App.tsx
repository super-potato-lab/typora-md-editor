import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { buildExportHtml, buildPrintHtml, printHtml } from "./editor/exportHtml";
import type { DocStats, OutlineItem } from "./editor/outline";
import {
  basename,
  dirname,
  errorMessage,
  exportHtmlFile,
  isTauri,
  openMarkdownFile,
  readMarkdownFile,
  replaceExtension,
  saveMarkdownFile,
  saveMarkdownFileAs,
} from "./files";
import { applyTheme, readSavedTheme, themes } from "./themes";
import { forgetRecent, readRecent, rememberRecent, type RecentFile } from "./recent";
import { DocumentDirProvider } from "./documentDir";
import { FindBar } from "./chrome/FindBar";
import { Menu, MenuItem, MenuSeparator } from "./chrome/Menu";
import { OutlineSidebar } from "./chrome/OutlineSidebar";
import { handleCloseRequest } from "./closeGuard";

interface Status {
  kind: "info" | "error";
  text: string;
}

interface Marks {
  bold: boolean;
  italic: boolean;
  code: boolean;
}

const OUTLINE_KEY = "markdown-editor.outline";

function shortcutLabel(key: string): string {
  const mod = /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl";
  return `${mod}+${key}`;
}

function readOutlineOpen(): boolean {
  try {
    return localStorage.getItem(OUTLINE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function App() {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const dirtyRef = useRef(false);
  const pathRef = useRef<string | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [theme, setTheme] = useState(readSavedTheme);
  const [status, setStatus] = useState<Status | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [stats, setStats] = useState<DocStats>({ words: 0, chars: 0 });
  const [marks, setMarks] = useState<Marks>({ bold: false, italic: false, code: false });
  const [outlineOpen, setOutlineOpen] = useState(readOutlineOpen);
  const [recent, setRecent] = useState<RecentFile[]>(readRecent);
  const [findOpen, setFindOpen] = useState(false);
  const [focusReplace, setFocusReplace] = useState(false);
  const [findToken, setFindToken] = useState(0);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [findCount, setFindCount] = useState(0);
  const [findActive, setFindActive] = useState(0);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    pathRef.current = path;
    editorRef.current?.setDocumentPath(path);
  }, [path]);

  useEffect(() => {
    const label = path ?? "Untitled";
    const title = `${dirty ? "• " : ""}${label} — Markdown Editor`;
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
    // X and Alt+F4 both emit close-requested. Tauri then calls destroy()
    // unless preventDefault ran, which needs core:window:allow-destroy.
    // window.confirm is synchronous and deadlocks WebView2 on Windows, so
    // the close never finishes. ask() is async and only runs when dirty.
    let asking = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const alreadyAsking = asking;
        if (dirtyRef.current && !alreadyAsking) asking = true;
        const outcome = await handleCloseRequest(event, dirtyRef.current, alreadyAsking, () =>
          ask("Discard unsaved changes?", {
            title: "Markdown Editor",
            kind: "warning",
          }),
        );
        if (outcome === "stay" && !alreadyAsking) asking = false;
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

  const note = useCallback((kind: Status["kind"], text: string) => {
    setStatus({ kind, text });
  }, []);

  const loadDocument = useCallback(
    (nextPath: string, content: string) => {
      editorRef.current?.setMarkdown(content);
      editorRef.current?.setDocumentPath(nextPath);
      setPath(nextPath);
      setRecent(rememberRecent(nextPath));
      setFindOpen(false);
      setFindQuery("");
      setFindCount(0);
      setFindActive(0);
      note("info", "Opened");
    },
    [note],
  );

  const confirmDiscard = useCallback(() => {
    return !dirtyRef.current || window.confirm("Discard unsaved changes?");
  }, []);

  const chooseTheme = useCallback((id: string) => {
    setTheme(applyTheme(id));
  }, []);

  const openFile = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const opened = await openMarkdownFile();
      if (!opened) return;
      loadDocument(opened.path, opened.content);
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [confirmDiscard, loadDocument, note]);

  const openRecent = useCallback(
    async (recentPath: string) => {
      if (recentPath === pathRef.current) return;
      if (!confirmDiscard()) return;
      try {
        const opened = await readMarkdownFile(recentPath);
        loadDocument(opened.path, opened.content);
      } catch (err) {
        setRecent(forgetRecent(recentPath));
        note("error", errorMessage(err));
      }
    },
    [confirmDiscard, loadDocument, note],
  );

  const saveAs = useCallback(async () => {
    try {
      const content = editorRef.current?.getMarkdown() ?? "";
      const suggested = pathRef.current ? basename(pathRef.current) : "Untitled.md";
      const saved = await saveMarkdownFileAs(content, suggested, pathRef.current);
      if (!saved) return;
      if (saved.content !== content) {
        editorRef.current?.setMarkdown(saved.content);
      }
      setPath(saved.path);
      editorRef.current?.setDocumentPath(saved.path);
      editorRef.current?.markSaved();
      setRecent(rememberRecent(saved.path));
      note("info", "Saved");
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [note]);

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
      setRecent(rememberRecent(current));
      note("info", "Saved");
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [note, saveAs]);

  const applyQuery = useCallback((query: string, matchCase: boolean) => {
    const snapshot = editorRef.current?.setFindQuery(query, matchCase) ?? { count: 0, active: 0 };
    setFindCount(snapshot.count);
    setFindActive(snapshot.active);
  }, []);

  const openFind = useCallback(
    (replace: boolean) => {
      setFocusReplace(replace);
      setFindOpen(true);
      setFindToken((value) => value + 1);
      if (findQuery) applyQuery(findQuery, caseSensitive);
    },
    [applyQuery, caseSensitive, findQuery],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    editorRef.current?.clearFind();
    setFindCount(0);
    setFindActive(0);
    editorRef.current?.focus();
  }, []);

  const exportHtml = useCallback(async () => {
    const html = buildExportHtml({
      title: pathRef.current ? basename(pathRef.current) : "Untitled",
      bodyHtml: editorRef.current?.getHTML() ?? "",
      themeId: theme,
    });
    const suggested = replaceExtension(pathRef.current, "html");
    if (!isTauri()) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggested;
      link.click();
      URL.revokeObjectURL(url);
      note("info", "Downloaded HTML");
      return;
    }
    try {
      const saved = await exportHtmlFile(html, suggested, pathRef.current ? dirname(pathRef.current) : null);
      if (!saved) return;
      note("info", "Exported HTML");
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [note, theme]);

  const exportPdf = useCallback(() => {
    const current = pathRef.current;
    try {
      const html = buildPrintHtml({
        title: current ? basename(current) : "Untitled",
        bodyHtml: editorRef.current?.getHTML() ?? "",
        themeId: theme,
        documentDir: current ? dirname(current) : null,
      });
      note("info", "Choose Save as PDF in the print dialog.");
      void printHtml(html).catch((err: unknown) => {
        note("error", errorMessage(err));
      });
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [note, theme]);

  const insertImage = useCallback(async () => {
    try {
      const inserted = await editorRef.current?.insertImageFromDialog();
      if (inserted) note("info", "Inserted image");
    } catch (err) {
      note("error", errorMessage(err));
    }
  }, [note]);

  const toggleOutline = useCallback(() => {
    setOutlineOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(OUTLINE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
      } else if (key === "f") {
        event.preventDefault();
        openFind(false);
      } else if (key === "h") {
        event.preventDefault();
        openFind(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFile, openFind, save, saveAs]);

  const docName = path ? basename(path) : "Untitled";
  const wordLabel = stats.words === 1 ? "1 word" : `${stats.words} words`;

  return (
    <DocumentDirProvider value={path ? dirname(path) : null}>
      <div className="app">
        <header className="chrome">
          <nav className="menus" aria-label="Editor">
            <Menu label="File">
              <MenuItem label="Open…" hint={shortcutLabel("O")} onSelect={() => void openFile()} />
              <MenuItem label="Save" hint={shortcutLabel("S")} onSelect={() => void save()} />
              <MenuItem label="Save As…" hint={shortcutLabel("⇧S")} onSelect={() => void saveAs()} />
              <MenuSeparator />
              <MenuItem label="Insert Image…" onSelect={() => void insertImage()} />
              <MenuItem label="Export HTML…" onSelect={() => void exportHtml()} />
              <MenuItem label="Export PDF…" onSelect={exportPdf} />
            </Menu>
            <Menu label="Edit">
              <MenuItem label="Find" hint={shortcutLabel("F")} onSelect={() => openFind(false)} />
              <MenuItem label="Replace" hint={shortcutLabel("H")} onSelect={() => openFind(true)} />
            </Menu>
            <Menu label="Format">
              <MenuItem
                label="Bold"
                hint={shortcutLabel("B")}
                checked={marks.bold}
                onSelect={() => editorRef.current?.toggleBold()}
              />
              <MenuItem
                label="Italic"
                hint={shortcutLabel("I")}
                checked={marks.italic}
                onSelect={() => editorRef.current?.toggleItalic()}
              />
              <MenuItem
                label="Code"
                hint={shortcutLabel("E")}
                checked={marks.code}
                onSelect={() => editorRef.current?.toggleCode()}
              />
            </Menu>
            <Menu label="View">
              <MenuItem label="Outline" checked={outlineOpen} onSelect={toggleOutline} />
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
        {findOpen && (
          <FindBar
            query={findQuery}
            replacement={replacement}
            count={findCount}
            active={findActive}
            caseSensitive={caseSensitive}
            findInputRef={findInputRef}
            replaceInputRef={replaceInputRef}
            focusReplace={focusReplace}
            focusToken={findToken}
            onQuery={(value) => {
              setFindQuery(value);
              const snapshot = editorRef.current?.setFindQuery(value, caseSensitive) ?? {
                count: 0,
                active: 0,
              };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onReplacement={setReplacement}
            onCase={(value) => {
              setCaseSensitive(value);
              const snapshot = editorRef.current?.setFindQuery(findQuery, value) ?? {
                count: 0,
                active: 0,
              };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onNext={() => {
              const snapshot = editorRef.current?.findNext(findQuery, caseSensitive) ?? {
                count: 0,
                active: 0,
              };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onPrev={() => {
              const snapshot = editorRef.current?.findPrevious(findQuery, caseSensitive) ?? {
                count: 0,
                active: 0,
              };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onReplace={() => {
              const snapshot =
                editorRef.current?.replaceCurrent(findQuery, replacement, caseSensitive) ?? {
                  count: 0,
                  active: 0,
                };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onReplaceAll={() => {
              const snapshot =
                editorRef.current?.replaceAll(findQuery, replacement, caseSensitive) ?? {
                  count: 0,
                  active: 0,
                };
              setFindCount(snapshot.count);
              setFindActive(snapshot.active);
            }}
            onClose={closeFind}
          />
        )}
        <div className="workspace">
          {outlineOpen && (
            <OutlineSidebar
              outline={outline}
              recent={recent}
              currentPath={path}
              onJump={(pos) => editorRef.current?.scrollToOutline(pos)}
              onOpenRecent={(recentPath) => void openRecent(recentPath)}
            />
          )}
          <div
            className="editor-scroll"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                editorRef.current?.focus();
              }
            }}
          >
            <MarkdownEditor
              ref={editorRef}
              onDirtyChange={setDirty}
              onDocumentChange={(nextOutline, nextStats) => {
                setOutline(nextOutline);
                setStats(nextStats);
              }}
              onMarksChange={setMarks}
              onError={(message) => note("error", message)}
            />
          </div>
        </div>
        <footer className="statusbar">
          <span>{wordLabel}</span>
          <span>{stats.chars} characters</span>
          <span className="statusbar-path" title={path ?? "Untitled"}>
            {path ?? "Untitled"}
          </span>
        </footer>
      </div>
    </DocumentDirProvider>
  );
}

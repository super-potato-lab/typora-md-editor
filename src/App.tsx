import { useCallback, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { buildExportHtml, buildPrintHtml, printHtml, renderRichHtml } from "./editor/exportHtml";
import type { DocStats, OutlineItem } from "./editor/outline";
import {
  basename,
  dirname,
  exportHtmlFile,
  isTauri,
  openMarkdownFile,
  readMarkdownFile,
  replaceExtension,
  saveMarkdownFile,
  saveMarkdownFileAs,
} from "./files";
import { localizeError, t, themeName, useI18n } from "./i18n";
import { applyTheme, readSavedTheme, themes } from "./themes";
import { forgetRecent, readRecent, rememberRecent, type RecentFile } from "./recent";
import { DocumentDirProvider } from "./documentDir";
import { FindBar } from "./chrome/FindBar";
import { Menu, MenuItem, MenuSeparator } from "./chrome/Menu";
import { OutlineSidebar } from "./chrome/OutlineSidebar";
import { handleCloseRequest } from "./closeGuard";
import { createSaveSerializer, savedSnapshotStillCurrent, type SaveSnapshot } from "./saveSession";

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
const MODE_KEY = "markdown-editor.mode";

function readMode(): EditorMode {
  try {
    return localStorage.getItem(MODE_KEY) === "source" ? "source" : "wysiwyg";
  } catch {
    return "wysiwyg";
  }
}

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
  const { locale, setLocale } = useI18n();
  const phrases = useRef({
    discard: t("confirm.discard"),
    title: t("app.name"),
    ok: t("confirm.discardOk"),
    cancel: t("confirm.cancel"),
  });
  phrases.current = {
    discard: t("confirm.discard"),
    title: t("app.name"),
    ok: t("confirm.discardOk"),
    cancel: t("confirm.cancel"),
  };
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const dirtyRef = useRef(false);
  const pathRef = useRef<string | null>(null);
  const saveSerializerRef = useRef<ReturnType<typeof createSaveSerializer> | null>(null);
  if (saveSerializerRef.current == null) {
    saveSerializerRef.current = createSaveSerializer();
  }
  const enqueueSave = saveSerializerRef.current.enqueue.bind(saveSerializerRef.current);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [theme, setTheme] = useState(readSavedTheme);
  const [status, setStatus] = useState<Status | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
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
  const [editorMode, setEditorMode] = useState<EditorMode>(readMode);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    pathRef.current = path;
    editorRef.current?.setDocumentPath(path);
  }, [path]);

  useEffect(() => {
    const label = path ?? t("doc.untitled");
    const title = t("window.title", {
      dirty: dirty ? "• " : "",
      name: label,
      app: t("app.name"),
    });
    document.title = title;
    if (!isTauri()) return;
    void getCurrentWindow().setTitle(title).catch(() => {
      /* title is cosmetic */
    });
  }, [path, dirty, locale]);

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
          ask(phrases.current.discard, {
            title: phrases.current.title,
            kind: "warning",
            okLabel: phrases.current.ok,
            cancelLabel: phrases.current.cancel,
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
      pathRef.current = nextPath;
      editorRef.current?.setMarkdown(content);
      editorRef.current?.setDocumentPath(nextPath);
      setPath(nextPath);
      setRecent(rememberRecent(nextPath));
      setFindOpen(false);
      setFindQuery("");
      setFindCount(0);
      setFindActive(0);
      note("info", t("status.opened"));
    },
    [note],
  );

  const confirmDiscard = useCallback(async () => {
    if (!dirtyRef.current) return true;
    if (isTauri()) {
      return ask(t("confirm.discard"), {
        title: t("app.name"),
        kind: "warning",
        okLabel: t("confirm.discardOk"),
        cancelLabel: t("confirm.cancel"),
      });
    }
    return window.confirm(t("confirm.discard"));
  }, []);

  const chooseTheme = useCallback((id: string) => {
    setTheme(applyTheme(id));
  }, []);

  const openFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    try {
      const opened = await openMarkdownFile({
        title: t("dialog.openTitle"),
        filter: t("dialog.filterMarkdown"),
      });
      if (!opened) return;
      loadDocument(opened.path, opened.content);
    } catch (err) {
      note("error", localizeError(err));
    }
  }, [confirmDiscard, loadDocument, note]);

  const openRecent = useCallback(
    async (recentPath: string) => {
      if (recentPath === pathRef.current) return;
      if (!(await confirmDiscard())) return;
      try {
        const opened = await readMarkdownFile(recentPath);
        loadDocument(opened.path, opened.content);
      } catch (err) {
        setRecent(forgetRecent(recentPath));
        note("error", localizeError(err));
      }
    },
    [confirmDiscard, loadDocument, note],
  );

  const saveAs = useCallback(async () => {
    const startedPath = pathRef.current;
    const markdown = editorRef.current?.getMarkdown() ?? "";
    const suggested = startedPath ? basename(startedPath) : t("doc.untitledFile");
    try {
      const saved = await saveMarkdownFileAs(markdown, suggested, startedPath, {
        title: t("dialog.saveTitle"),
        filter: t("dialog.filterMarkdown"),
      });
      if (!saved) return;
      const snapshot: SaveSnapshot = { path: saved.path, markdown: saved.content };
      // The dialog already wrote the file, including rewritten image links.
      // Queue that same text so an older save of this path cannot finish last.
      await enqueueSave(saved.path, async () => {
        await saveMarkdownFile(saved.path, saved.content);
        setRecent(rememberRecent(saved.path));
        if (pathRef.current !== startedPath) return;
        const stillSnapshot = savedSnapshotStillCurrent(
          { path: startedPath, markdown },
          { path: startedPath, markdown: editorRef.current?.getMarkdown() ?? "" },
        );
        pathRef.current = saved.path;
        setPath(saved.path);
        editorRef.current?.setDocumentPath(saved.path);
        if (stillSnapshot) {
          if (saved.content !== markdown) {
            editorRef.current?.setMarkdown(saved.content);
          } else {
            editorRef.current?.markSaved(snapshot);
          }
        }
        note("info", t("status.saved"));
      });
    } catch (err) {
      note("error", localizeError(err));
    }
  }, [note]);

  const save = useCallback(async () => {
    const current = pathRef.current;
    if (!current) {
      await saveAs();
      return;
    }
    const markdown = editorRef.current?.getMarkdown() ?? "";
    const snapshot: SaveSnapshot = { path: current, markdown };
    try {
      await enqueueSave(current, async () => {
        await saveMarkdownFile(current, markdown);
        setRecent(rememberRecent(current));
        editorRef.current?.markSaved(snapshot);
        if (pathRef.current === current) note("info", t("status.saved"));
      });
    } catch (err) {
      note("error", localizeError(err));
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
      title: pathRef.current ? basename(pathRef.current) : t("doc.untitled"),
      bodyHtml: await renderRichHtml(editorRef.current?.getHTML() ?? ""),
      themeId: theme,
    });
    const suggested = replaceExtension(pathRef.current, "html", t("doc.untitledFile"));
    if (!isTauri()) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggested;
      link.click();
      URL.revokeObjectURL(url);
      note("info", t("status.downloadedHtml"));
      return;
    }
    try {
      const saved = await exportHtmlFile(
        html,
        suggested,
        pathRef.current ? dirname(pathRef.current) : null,
        {
          title: t("dialog.exportTitle"),
          filter: t("dialog.filterHtml"),
        },
      );
      if (!saved) return;
      note("info", t("status.exportedHtml"));
    } catch (err) {
      note("error", localizeError(err));
    }
  }, [note, theme]);

  const exportPdf = useCallback(async () => {
    const current = pathRef.current;
    try {
      const html = buildPrintHtml({
        title: current ? basename(current) : t("doc.untitled"),
        bodyHtml: await renderRichHtml(editorRef.current?.getHTML() ?? ""),
        themeId: theme,
        documentDir: current ? dirname(current) : null,
      });
      note("info", t("status.printPdf"));
      await printHtml(html, t("print.frameTitle"));
    } catch (err) {
      note("error", localizeError(err));
    }
  }, [note, theme]);

  const insertImage = useCallback(async () => {
    try {
      const inserted = await editorRef.current?.insertImageFromDialog();
      if (inserted) note("info", t("status.insertedImage"));
    } catch (err) {
      note("error", localizeError(err));
    }
  }, [note]);

  const chooseMode = useCallback((next: EditorMode) => {
    setEditorMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMode = useCallback(() => {
    setEditorMode((current) => {
      const next = current === "source" ? "wysiwyg" : "source";
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const insertToc = useCallback(() => {
    const inserted = editorRef.current?.insertTableOfContents() ?? false;
    note(inserted ? "info" : "error", inserted ? t("status.insertedToc") : t("status.noHeadings"));
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
      } else if (key === "\\") {
        event.preventDefault();
        toggleMode();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFile, openFind, save, saveAs, toggleMode]);

  useEffect(() => {
    if (!findOpen) return;
    const snapshot = editorRef.current?.setFindQuery(findQuery, caseSensitive) ?? {
      count: 0,
      active: 0,
    };
    setFindCount(snapshot.count);
    setFindActive(snapshot.active);
  }, [editorMode]);

  const untitled = t("doc.untitled");
  const docName = path ? basename(path) : untitled;
  const wordLabel =
    stats.words === 1 ? t("status.words.one") : t("status.words.other", { count: stats.words });

  return (
    <DocumentDirProvider value={path ? dirname(path) : null}>
      <div className="app">
        <header className="chrome">
          <nav className="menus" aria-label={t("menu.editor")}>
            <Menu label={t("menu.file")}>
              <MenuItem label={t("file.open")} hint={shortcutLabel("O")} onSelect={() => void openFile()} />
              <MenuItem label={t("file.save")} hint={shortcutLabel("S")} onSelect={() => void save()} />
              <MenuItem label={t("file.saveAs")} hint={shortcutLabel("⇧S")} onSelect={() => void saveAs()} />
              <MenuSeparator />
              <MenuItem label={t("file.insertImage")} onSelect={() => void insertImage()} />
              <MenuItem label={t("file.exportHtml")} onSelect={() => void exportHtml()} />
              <MenuItem label={t("file.exportPdf")} onSelect={() => void exportPdf()} />
            </Menu>
            <Menu label={t("menu.edit")}>
              <MenuItem label={t("edit.find")} hint={shortcutLabel("F")} onSelect={() => openFind(false)} />
              <MenuItem label={t("edit.replace")} hint={shortcutLabel("H")} onSelect={() => openFind(true)} />
            </Menu>
            <Menu label={t("menu.format")}>
              <MenuItem
                label={t("format.bold")}
                hint={shortcutLabel("B")}
                checked={marks.bold}
                onSelect={() => editorRef.current?.toggleBold()}
              />
              <MenuItem
                label={t("format.italic")}
                hint={shortcutLabel("I")}
                checked={marks.italic}
                onSelect={() => editorRef.current?.toggleItalic()}
              />
              <MenuItem
                label={t("format.code")}
                hint={shortcutLabel("E")}
                checked={marks.code}
                onSelect={() => editorRef.current?.toggleCode()}
              />
              <MenuSeparator />
              <MenuItem label={t("format.inlineMath")} onSelect={() => editorRef.current?.insertInlineMath()} />
              <MenuItem label={t("format.blockMath")} onSelect={() => editorRef.current?.insertBlockMath()} />
              <MenuItem label={t("format.mermaid")} onSelect={() => editorRef.current?.insertMermaid()} />
              <MenuItem label={t("format.footnote")} onSelect={() => editorRef.current?.insertFootnote()} />
              <MenuItem label={t("format.toc")} onSelect={insertToc} />
            </Menu>
            <Menu label={t("menu.view")}>
              <MenuItem
                label={t("view.wysiwyg")}
                checked={editorMode === "wysiwyg"}
                onSelect={() => chooseMode("wysiwyg")}
              />
              <MenuItem
                label={t("view.source")}
                hint={shortcutLabel("\\")}
                checked={editorMode === "source"}
                onSelect={() => chooseMode("source")}
              />
              <MenuSeparator />
              <MenuItem label={t("view.outline")} checked={outlineOpen} onSelect={toggleOutline} />
              <MenuSeparator />
              <MenuItem
                label={t("language.zhCN")}
                checked={locale === "zh-CN"}
                onSelect={() => setLocale("zh-CN")}
              />
              <MenuItem
                label={t("language.en")}
                checked={locale === "en"}
                onSelect={() => setLocale("en")}
              />
            </Menu>
            <Menu label={t("menu.theme")}>
              {themes.map((item) => (
                <MenuItem
                  key={item.id}
                  label={themeName(item.id, item.label)}
                  checked={item.id === theme}
                  onSelect={() => chooseTheme(item.id)}
                />
              ))}
            </Menu>
          </nav>
          <div className="mode-toggle" role="group" aria-label={t("view.mode")}>
            <button
              type="button"
              aria-pressed={editorMode === "wysiwyg"}
              onClick={() => chooseMode("wysiwyg")}
            >
              {t("view.wysiwyg")}
            </button>
            <button
              type="button"
              aria-pressed={editorMode === "source"}
              onClick={() => chooseMode("source")}
            >
              {t("view.source")}
            </button>
          </div>
          <div className="chrome-meta">
            {status && (
              <span className={status.kind === "error" ? "status error" : "status"} role="status">
                {status.text}
              </span>
            )}
            <span className="doc-name" title={path ?? untitled}>
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
              activePos={activePos}
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
              mode={editorMode}
              onDirtyChange={setDirty}
              onDocumentChange={(nextOutline, nextStats) => {
                setOutline(nextOutline);
                setStats(nextStats);
              }}
              onActiveHeading={setActivePos}
              onMarksChange={setMarks}
              onError={(message) => note("error", localizeError(message))}
            />
          </div>
        </div>
        <footer className="statusbar">
          <button
            type="button"
            className="sidebar-toggle"
            aria-pressed={outlineOpen}
            aria-label={t("sidebar.toggle")}
            title={t("sidebar.toggle")}
            onClick={toggleOutline}
          >
            <SidebarToggleIcon />
          </button>
          <span>{wordLabel}</span>
          <span>{t("status.chars", { count: stats.chars })}</span>
          <span>{editorMode === "source" ? t("view.source") : t("view.wysiwyg")}</span>
          <span className="statusbar-path" title={path ?? untitled}>
            {path ?? untitled}
          </span>
        </footer>
      </div>
    </DocumentDirProvider>
  );
}

function SidebarToggleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="1.25"
        y="2.25"
        width="13.5"
        height="11.5"
        rx="1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6.1 2.4v11.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

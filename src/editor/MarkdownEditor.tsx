import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { WELCOME_MARKDOWN } from "./welcome";
import {
  activeHeadingPos,
  collectOutline,
  collectOutlineFromMarkdown,
  documentStats,
  type DocStats,
  type OutlineItem,
} from "./outline";
import {
  clearFind,
  findInString,
  replaceAllMatches,
  replaceCurrentMatch,
  resolveMatchIndex,
  showFind,
  spliceMatches,
  type FindSnapshot,
  type TextMatch,
} from "./find";
import { createEditorExtensions } from "./extensions";
import { nextFootnoteId } from "./footnotes";
import { loadMarkdownDocument } from "./loadDocument";
import { MERMAID_TEMPLATE } from "./mermaid";
import { editorMarkdown, setMarkdownDocument } from "./setMarkdownDocument";
import { tableOfContentsMarkdown } from "./slug";
import { isTauri, pickAndSaveImage, savePastedImage } from "../files";
import { t, useI18n } from "../i18n";
import { canonicalMarkdown, savedSnapshotStillCurrent, type SaveSnapshot } from "../saveSession";

export type EditorMode = "wysiwyg" | "source";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  markSaved: (snapshot: SaveSnapshot) => void;
  focus: () => void;
  scrollToOutline: (pos: number) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleCode: () => void;
  getHTML: () => string;
  setDocumentPath: (path: string | null) => void;
  setFindQuery: (query: string, caseSensitive: boolean) => FindSnapshot;
  findNext: (query: string, caseSensitive: boolean) => FindSnapshot;
  findPrevious: (query: string, caseSensitive: boolean) => FindSnapshot;
  replaceCurrent: (query: string, replacement: string, caseSensitive: boolean) => FindSnapshot;
  replaceAll: (query: string, replacement: string, caseSensitive: boolean) => FindSnapshot;
  clearFind: () => void;
  insertImageFiles: (files: File[], pos?: number) => Promise<void>;
  insertImageFromDialog: () => Promise<boolean>;
  insertInlineMath: () => void;
  insertBlockMath: () => void;
  insertMermaid: () => void;
  insertFootnote: () => void;
  insertTableOfContents: () => boolean;
}

interface MarkdownEditorProps {
  mode: EditorMode;
  onDirtyChange: (dirty: boolean) => void;
  onDocumentChange: (outline: OutlineItem[], stats: DocStats) => void;
  onMarksChange: (marks: { bold: boolean; italic: boolean; code: boolean }) => void;
  onActiveHeading: (pos: number | null) => void;
  onError: (message: string) => void;
}

function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = [...data.files].filter((file) => file.type.startsWith("image/"));
  if (fromFiles.length > 0) return fromFiles;
  return [...data.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

function altFromRelative(relative: string): string {
  const file = relative.split("/").pop() ?? "image";
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return stem || "image";
}

function extensionFor(type: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

function lineHeightOf(el: HTMLElement): number {
  const parsed = Number.parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(parsed) ? parsed : 22;
}

function revealOffset(textarea: HTMLTextAreaElement, offset: number) {
  const lineHeight = lineHeightOf(textarea);
  const line = textarea.value.slice(0, offset).split("\n").length;
  const top = Math.max(0, (line - 2) * lineHeight);
  if (top < textarea.scrollTop || top > textarea.scrollTop + textarea.clientHeight - lineHeight) {
    textarea.scrollTop = top;
  }
}

function offsetFromTextareaScroll(textarea: HTMLTextAreaElement): number {
  const lineHeight = lineHeightOf(textarea);
  const line = Math.max(0, Math.floor((textarea.scrollTop + 8) / lineHeight));
  const lines = textarea.value.split("\n");
  let offset = 0;
  for (let index = 0; index < line && index < lines.length; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }
  return offset;
}

function textareaCaretVisible(textarea: HTMLTextAreaElement): boolean {
  const lineHeight = lineHeightOf(textarea);
  const line = textarea.value.slice(0, textarea.selectionStart).split("\n").length - 1;
  const top = line * lineHeight;
  return top >= textarea.scrollTop - 2 && top <= textarea.scrollTop + textarea.clientHeight - lineHeight;
}

function selectionVisible(editor: Editor, scrollEl: HTMLElement): boolean {
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const box = scrollEl.getBoundingClientRect();
    return coords.bottom > box.top + 4 && coords.top < box.bottom - 4;
  } catch {
    return false;
  }
}

function headingAtScrollEdge(editor: Editor, scrollEl: HTMLElement, items: OutlineItem[]): number | null {
  if (items.length === 0) return null;
  const box = scrollEl.getBoundingClientRect();
  const edge = box.top + Math.min(96, Math.max(32, box.height * 0.2));
  let current: number | null = null;
  for (const item of items) {
    const dom = editor.view.nodeDOM(item.pos);
    if (!(dom instanceof HTMLElement)) continue;
    if (dom.getBoundingClientRect().top <= edge) current = item.pos;
    else break;
  }
  if (current != null) return current;
  const first = editor.view.nodeDOM(items[0].pos);
  if (first instanceof HTMLElement && first.getBoundingClientRect().top < box.bottom) {
    return items[0].pos;
  }
  return null;
}

function scrollToHash(root: HTMLElement, href: string): boolean {
  if (!href.startsWith("#") || href.length < 2) return false;
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    return false;
  }
  const target = root.querySelector(`#${CSS.escape(id)}`);
  if (!(target instanceof HTMLElement)) return false;
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { mode, onDirtyChange, onDocumentChange, onMarksChange, onActiveHeading, onError },
    ref,
  ) {
    const { locale } = useI18n();
    const placeholderRef = useRef(t("editor.placeholder"));
    placeholderRef.current = t("editor.placeholder");
    const baselineRef = useRef(canonicalMarkdown(WELCOME_MARKDOWN));
    const onDirtyRef = useRef(onDirtyChange);
    const onDocumentRef = useRef(onDocumentChange);
    const onMarksRef = useRef(onMarksChange);
    const onActiveRef = useRef(onActiveHeading);
    const onErrorRef = useRef(onError);
    const lastActiveRef = useRef<number | null | undefined>(undefined);
    const pinnedPosRef = useRef<number | null>(null);
    const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const documentPathRef = useRef<string | null>(null);
    const insertFilesRef = useRef<(files: File[], pos?: number) => Promise<void>>(async () => {});
    const findIndexRef = useRef(0);
    const findMatchesRef = useRef<TextMatch[]>([]);
    const findingRef = useRef(false);
    const modeRef = useRef(mode);
    const sourceRef = useRef(WELCOME_MARKDOWN);
    const sourceEl = useRef<HTMLTextAreaElement>(null);
    const editorRef = useRef<Editor | null>(null);
    const pendingSelection = useRef<TextMatch | null>(null);
    const [sourceText, setSourceText] = useState(WELCOME_MARKDOWN);
    const [selectionTick, setSelectionTick] = useState(0);
    onDirtyRef.current = onDirtyChange;
    onDocumentRef.current = onDocumentChange;
    onMarksRef.current = onMarksChange;
    onActiveRef.current = onActiveHeading;
    onErrorRef.current = onError;

    const reportActive = (pos: number | null) => {
      if (lastActiveRef.current === pos) return;
      lastActiveRef.current = pos;
      onActiveRef.current(pos);
    };

    const pinHeading = (pos: number) => {
      pinnedPosRef.current = pos;
      if (pinTimerRef.current != null) clearTimeout(pinTimerRef.current);
      pinTimerRef.current = setTimeout(() => {
        if (pinnedPosRef.current === pos) pinnedPosRef.current = null;
        pinTimerRef.current = null;
      }, 800);
    };

    const syncFromCaret = (current: Editor) => {
      reportActive(activeHeadingPos(collectOutline(current.state.doc), current.state.selection.from));
    };

    const publish = (current: Editor) => {
      onDocumentRef.current(collectOutline(current.state.doc), documentStats(current.getText()));
      onMarksRef.current({
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        code: current.isActive("code"),
      });
    };

    const publishSource = (markdown: string) => {
      onDocumentRef.current(collectOutlineFromMarkdown(markdown), documentStats(markdown));
      onMarksRef.current({ bold: false, italic: false, code: false });
    };

    const commitSource = (markdown: string, selection?: TextMatch) => {
      sourceRef.current = markdown;
      setSourceText(markdown);
      onDirtyRef.current(canonicalMarkdown(markdown) !== baselineRef.current);
      publishSource(markdown);
      if (selection) {
        pendingSelection.current = selection;
        setSelectionTick((value) => value + 1);
      }
    };

    const editor = useEditor({
      extensions: createEditorExtensions(
        {
          onEditInlineMath: (latex, pos) => {
            const current = editorRef.current;
            if (!current) return;
            const next = window.prompt(t("math.prompt"), latex);
            if (next == null) return;
            current.chain().setNodeSelection(pos).updateInlineMath({ latex: next }).focus().run();
          },
          onEditBlockMath: (latex, pos) => {
            const current = editorRef.current;
            if (!current) return;
            const next = window.prompt(t("math.prompt"), latex);
            if (next == null) return;
            current.chain().setNodeSelection(pos).updateBlockMath({ latex: next }).focus().run();
          },
        },
        () => placeholderRef.current,
      ),
      content: WELCOME_MARKDOWN,
      contentType: "markdown",
      editorProps: {
        attributes: {
          spellcheck: "true",
          "aria-label": t("editor.aria"),
        },
        handleClick: (view, _pos, event) => {
          const target = event.target;
          if (!(target instanceof Element)) return false;
          const anchor = target.closest("a");
          const href = anchor?.getAttribute("href");
          if (!href) return false;
          return scrollToHash(view.dom, href);
        },
        handlePaste: (_view, event) => {
          const files = imageFilesFrom(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFilesRef.current(files).catch((err: unknown) => {
            onErrorRef.current(errorText(err));
          });
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = imageFilesFrom(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          const coords = { left: event.clientX, top: event.clientY };
          const pos = view.posAtCoords(coords)?.pos;
          void insertFilesRef.current(files, pos).catch((err: unknown) => {
            onErrorRef.current(errorText(err));
          });
          return true;
        },
      },
      onCreate: ({ editor: created }) => {
        const markdown = editorMarkdown(created);
        sourceRef.current = markdown;
        setSourceText(markdown);
        baselineRef.current = canonicalMarkdown(markdown);
        onDirtyRef.current(false);
        if (modeRef.current === "source") {
          publishSource(markdown);
          reportActive(activeHeadingPos(collectOutlineFromMarkdown(markdown), 0));
        } else {
          publish(created);
          syncFromCaret(created);
        }
      },
      onUpdate: ({ editor: updated }) => {
        if (modeRef.current === "source") return;
        onDirtyRef.current(canonicalMarkdown(editorMarkdown(updated)) !== baselineRef.current);
        publish(updated);
        syncFromCaret(updated);
      },
      onSelectionUpdate: ({ editor: updated }) => {
        if (modeRef.current === "source") return;
        onMarksRef.current({
          bold: updated.isActive("bold"),
          italic: updated.isActive("italic"),
          code: updated.isActive("code"),
        });
        syncFromCaret(updated);
      },
    });

    editorRef.current = editor;

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.view.dom.setAttribute("aria-label", t("editor.aria"));
      editor.view.updateState(editor.view.state);
    }, [editor, locale]);

    useEffect(() => {
      if (!editor) return;
      if (modeRef.current === mode) return;
      const previous = modeRef.current;
      modeRef.current = mode;
      if (mode === "source") {
        const markdown = editorMarkdown(editor);
        sourceRef.current = markdown;
        setSourceText(markdown);
        publishSource(markdown);
        pendingSelection.current = { from: markdown.length, to: markdown.length };
        setSelectionTick((value) => value + 1);
        return;
      }
      if (previous === "source") {
        setMarkdownDocument(editor, sourceRef.current, false);
        clearFind(editor);
        findMatchesRef.current = [];
        findIndexRef.current = 0;
        onDirtyRef.current(canonicalMarkdown(editorMarkdown(editor)) !== baselineRef.current);
        publish(editor);
        syncFromCaret(editor);
        editor.commands.focus("end");
      }
    }, [mode, editor]);

    useEffect(() => {
      if (!editor || mode !== "wysiwyg") return;
      const scrollEl = editor.view.dom.closest(".editor-scroll");
      if (!(scrollEl instanceof HTMLElement)) return;
      let frame = 0;
      const update = () => {
        frame = 0;
        if (editor.isDestroyed || modeRef.current !== "wysiwyg") return;
        const pinned = pinnedPosRef.current;
        if (pinned != null) {
          const dom = editor.view.nodeDOM(pinned);
          if (!(dom instanceof HTMLElement)) return;
          const top = dom.getBoundingClientRect().top;
          const box = scrollEl.getBoundingClientRect();
          if (Math.abs(top - box.top) >= 56) return;
          pinnedPosRef.current = null;
        }
        const items = collectOutline(editor.state.doc);
        if (selectionVisible(editor, scrollEl)) {
          reportActive(activeHeadingPos(items, editor.state.selection.from));
          return;
        }
        reportActive(headingAtScrollEdge(editor, scrollEl, items));
      };
      const onScroll = () => {
        if (frame) return;
        frame = requestAnimationFrame(update);
      };
      update();
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        scrollEl.removeEventListener("scroll", onScroll);
        if (frame) cancelAnimationFrame(frame);
      };
    }, [editor, mode]);

    useEffect(() => {
      if (mode !== "source") return;
      const field = sourceEl.current;
      if (!field) return;
      const update = () => {
        if (modeRef.current !== "source") return;
        const pinned = pinnedPosRef.current;
        if (pinned != null) {
          const lineHeight = lineHeightOf(field);
          const line = field.value.slice(0, pinned).split("\n").length - 1;
          const top = line * lineHeight;
          const visible = top >= field.scrollTop - 4 && top <= field.scrollTop + field.clientHeight - lineHeight;
          if (!visible) return;
          pinnedPosRef.current = null;
        }
        const items = collectOutlineFromMarkdown(sourceRef.current);
        const offset = textareaCaretVisible(field) ? field.selectionStart : offsetFromTextareaScroll(field);
        reportActive(activeHeadingPos(items, offset));
      };
      update();
      field.addEventListener("keyup", update);
      field.addEventListener("click", update);
      field.addEventListener("scroll", update);
      return () => {
        field.removeEventListener("keyup", update);
        field.removeEventListener("click", update);
        field.removeEventListener("scroll", update);
      };
    }, [mode, sourceText]);

    useEffect(() => {
      const range = pendingSelection.current;
      const field = sourceEl.current;
      if (!range || !field || mode !== "source") return;
      pendingSelection.current = null;
      field.focus();
      const from = Math.min(range.from, field.value.length);
      const to = Math.min(range.to, field.value.length);
      field.setSelectionRange(from, to);
      revealOffset(field, from);
      reportActive(activeHeadingPos(collectOutlineFromMarkdown(field.value), from));
    }, [sourceText, selectionTick, mode]);

    const insertSource = (snippet: string) => {
      const current = sourceRef.current;
      const field = sourceEl.current;
      const start = field?.selectionStart ?? current.length;
      const end = field?.selectionEnd ?? start;
      const next = current.slice(0, start) + snippet + current.slice(end);
      const caret = start + snippet.length;
      commitSource(next, { from: caret, to: caret });
    };

    const toggleSourceWrap = (marker: string) => {
      const current = sourceRef.current;
      const field = sourceEl.current;
      const start = field?.selectionStart ?? current.length;
      const end = field?.selectionEnd ?? start;
      const selected = current.slice(start, end);
      const before = current.slice(start - marker.length, start);
      const after = current.slice(end, end + marker.length);
      if (before === marker && after === marker) {
        const next = current.slice(0, start - marker.length) + selected + current.slice(end + marker.length);
        commitSource(next, { from: start - marker.length, to: end - marker.length });
        return;
      }
      const next = current.slice(0, start) + marker + selected + marker + current.slice(end);
      commitSource(next, { from: start + marker.length, to: end + marker.length });
    };

    insertFilesRef.current = async (files: File[], pos?: number) => {
      const path = documentPathRef.current;
      if (!path) throw new Error("Save the document before inserting an image.");
      if (!isTauri()) throw new Error("Image files are saved beside the document in the desktop app.");
      const snippets: string[] = [];
      for (const file of files) {
        const name = file.name || `image.${extensionFor(file.type)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const saved = await savePastedImage(path, name, bytes);
        snippets.push(`![${altFromRelative(saved.relativePath)}](${saved.relativePath})`);
      }
      const markdown = snippets.join("\n\n");
      if (modeRef.current === "source") {
        insertSource(markdown);
        return;
      }
      if (!editor) return;
      if (pos != null) editor.commands.setTextSelection(pos);
      editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
    };

    function currentMarkdown(): string {
      if (modeRef.current === "source") return sourceRef.current;
      return editor ? editorMarkdown(editor) : sourceRef.current;
    }

    function runFind(query: string, caseSensitive: boolean, index: number): FindSnapshot {
      if (modeRef.current === "source") {
        if (!query) {
          findMatchesRef.current = [];
          findIndexRef.current = 0;
          return { count: 0, active: 0 };
        }
        const matches = findInString(sourceRef.current, query, caseSensitive);
        findMatchesRef.current = matches;
        const resolved = resolveMatchIndex(index, matches.length);
        findIndexRef.current = resolved;
        const current = matches[resolved];
        if (current) {
          pendingSelection.current = current;
          setSelectionTick((value) => value + 1);
        }
        return { count: matches.length, active: matches.length ? resolved + 1 : 0 };
      }
      if (!editor) return { count: 0, active: 0 };
      findingRef.current = true;
      try {
        if (!query) {
          clearFind(editor);
          findMatchesRef.current = [];
          findIndexRef.current = 0;
          return { count: 0, active: 0 };
        }
        const result = showFind(editor, query, caseSensitive, index);
        findMatchesRef.current = result.matches;
        findIndexRef.current = result.index;
        return result.snapshot;
      } finally {
        findingRef.current = false;
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => currentMarkdown(),
        setMarkdown: (markdown: string) => {
          if (!editor) return;
          loadMarkdownDocument(editor, markdown);
          clearFind(editor);
          findMatchesRef.current = [];
          findIndexRef.current = 0;
          if (modeRef.current === "source") {
            sourceRef.current = markdown;
            setSourceText(markdown);
            baselineRef.current = canonicalMarkdown(markdown);
            publishSource(markdown);
          } else {
            const normalized = editorMarkdown(editor);
            sourceRef.current = normalized;
            setSourceText(normalized);
            baselineRef.current = canonicalMarkdown(normalized);
            publish(editor);
          }
          onDirtyRef.current(false);
        },
        markSaved: (snapshot) => {
          const current = { path: documentPathRef.current, markdown: currentMarkdown() };
          if (!savedSnapshotStillCurrent(snapshot, current)) return;
          baselineRef.current = canonicalMarkdown(current.markdown);
          onDirtyRef.current(false);
        },
        focus: () => {
          if (modeRef.current === "source") {
            sourceEl.current?.focus();
            return;
          }
          editor?.commands.focus("end");
        },
        scrollToOutline: (pos: number) => {
          if (modeRef.current === "source") {
            pinHeading(pos);
            pendingSelection.current = { from: pos, to: pos };
            setSelectionTick((value) => value + 1);
            reportActive(activeHeadingPos(collectOutlineFromMarkdown(sourceRef.current), pos));
            return;
          }
          if (!editor) return;
          pinHeading(pos);
          const dom = editor.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) {
            dom.scrollIntoView({ block: "start", behavior: "smooth" });
          }
          const target = Math.min(pos + 1, editor.state.doc.content.size);
          editor.chain().setTextSelection(target).focus().run();
          reportActive(activeHeadingPos(collectOutline(editor.state.doc), target));
        },
        toggleBold: () => {
          if (modeRef.current === "source") {
            toggleSourceWrap("**");
            return;
          }
          editor?.chain().focus().toggleBold().run();
        },
        toggleItalic: () => {
          if (modeRef.current === "source") {
            toggleSourceWrap("*");
            return;
          }
          editor?.chain().focus().toggleItalic().run();
        },
        toggleCode: () => {
          if (modeRef.current === "source") {
            toggleSourceWrap("`");
            return;
          }
          editor?.chain().focus().toggleCode().run();
        },
        getHTML: () => {
          if (!editor) return "";
          if (modeRef.current === "source") {
            setMarkdownDocument(editor, sourceRef.current, false);
          }
          return editor.getHTML();
        },
        setDocumentPath: (path: string | null) => {
          documentPathRef.current = path;
        },
        setFindQuery: (query, caseSensitive) => runFind(query, caseSensitive, 0),
        findNext: (query, caseSensitive) => runFind(query, caseSensitive, findIndexRef.current + 1),
        findPrevious: (query, caseSensitive) =>
          runFind(query, caseSensitive, findIndexRef.current - 1),
        replaceCurrent: (query, replacement, caseSensitive) => {
          if (!query) return { count: 0, active: 0 };
          if (modeRef.current === "source") {
            const matches = findInString(sourceRef.current, query, caseSensitive);
            const index = resolveMatchIndex(findIndexRef.current, matches.length);
            const current = matches[index];
            if (!current) return runFind(query, caseSensitive, 0);
            commitSource(spliceMatches(sourceRef.current, [current], replacement));
            return runFind(query, caseSensitive, index);
          }
          if (!editor) return { count: 0, active: 0 };
          const result = replaceCurrentMatch(
            editor,
            query,
            replacement,
            caseSensitive,
            findIndexRef.current,
          );
          findIndexRef.current = result.index;
          return result.snapshot;
        },
        replaceAll: (query, replacement, caseSensitive) => {
          if (!query) return { count: 0, active: 0 };
          if (modeRef.current === "source") {
            const matches = findInString(sourceRef.current, query, caseSensitive);
            if (matches.length === 0) return runFind(query, caseSensitive, 0);
            commitSource(spliceMatches(sourceRef.current, matches, replacement));
            return runFind(query, caseSensitive, 0);
          }
          if (!editor) return { count: 0, active: 0 };
          const result = replaceAllMatches(editor, query, replacement, caseSensitive);
          findIndexRef.current = result.index;
          return result.snapshot;
        },
        clearFind: () => {
          findMatchesRef.current = [];
          findIndexRef.current = 0;
          if (editor) clearFind(editor);
        },
        insertImageFiles: (files, pos) => insertFilesRef.current(files, pos),
        insertImageFromDialog: async () => {
          const path = documentPathRef.current;
          if (!path) throw new Error("Save the document before inserting an image.");
          const saved = await pickAndSaveImage(path, {
            title: t("dialog.imageTitle"),
            filter: t("dialog.filterImages"),
          });
          if (!saved) return false;
          const markdown = `![${altFromRelative(saved.relativePath)}](${saved.relativePath})`;
          if (modeRef.current === "source") {
            insertSource(markdown);
            return true;
          }
          if (!editor) return false;
          editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
          return true;
        },
        insertInlineMath: () => {
          const latex = window.prompt(t("math.inlinePrompt"), "E = mc^2");
          if (latex == null || !latex.trim()) return;
          const value = latex.trim();
          if (modeRef.current === "source") {
            insertSource(`$${value}$`);
            return;
          }
          editor?.chain().focus().insertInlineMath({ latex: value }).run();
        },
        insertBlockMath: () => {
          const latex = window.prompt(t("math.blockPrompt"), "\\int_0^1 x^2 \\, dx");
          if (latex == null || !latex.trim()) return;
          const value = latex.trim();
          if (modeRef.current === "source") {
            insertSource(`$$\n${value}\n$$\n`);
            return;
          }
          editor?.chain().focus().insertBlockMath({ latex: value }).run();
        },
        insertMermaid: () => {
          if (modeRef.current === "source") {
            insertSource(MERMAID_TEMPLATE);
            return;
          }
          editor?.chain().focus().insertContent(MERMAID_TEMPLATE, { contentType: "markdown" }).run();
        },
        insertFootnote: () => {
          const id = nextFootnoteId(currentMarkdown());
          if (modeRef.current === "source") {
            const current = sourceRef.current;
            const field = sourceEl.current;
            const start = field?.selectionStart ?? current.length;
            const end = field?.selectionEnd ?? start;
            const withRef = `${current.slice(0, start)}[^${id}]${current.slice(end)}`;
            const next = `${withRef.replace(/\s*$/u, "")}\n\n[^${id}]: `;
            commitSource(next, { from: next.length, to: next.length });
            return;
          }
          if (!editor) return;
          editor.chain().focus().insertContent(`[^${id}]`, { contentType: "markdown" }).run();
          editor.commands.insertContentAt(editor.state.doc.content.size, `\n\n[^${id}]: `, {
            contentType: "markdown",
          });
        },
        insertTableOfContents: () => {
          if (!editor) return false;
          const headings =
            modeRef.current === "source"
              ? collectOutlineFromMarkdown(sourceRef.current)
              : collectOutline(editor.state.doc);
          const markdown = tableOfContentsMarkdown(headings);
          if (!markdown) return false;
          const block = `${markdown}\n\n`;
          if (modeRef.current === "source") {
            insertSource(block);
            return true;
          }
          editor.chain().focus().insertContent(block, { contentType: "markdown" }).run();
          return true;
        },
      }),
      [editor],
    );

    return (
      <div className={mode === "source" ? "editor-frame source-mode" : "editor-frame"}>
        <div hidden={mode === "source"}>
          <EditorContent editor={editor} id="write" />
        </div>
        {mode === "source" && (
          <textarea
            ref={sourceEl}
            className="source-editor"
            aria-label={t("editor.sourceAria")}
            spellCheck={false}
            value={sourceText}
            onChange={(event) => commitSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              event.preventDefault();
              insertSource("  ");
            }}
          />
        )}
      </div>
    );
  },
);

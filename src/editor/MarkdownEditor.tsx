import { forwardRef, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { WELCOME_MARKDOWN } from "./welcome";
import { collectOutline, documentStats, type DocStats, type OutlineItem } from "./outline";
import {
  FindReplace,
  clearFind,
  replaceMatch,
  replaceMatches,
  showFind,
  type FindSnapshot,
  type TextMatch,
} from "./find";
import { PreviewImage } from "./PreviewImage";
import { isTauri, pickAndSaveImage, savePastedImage } from "../files";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  markSaved: () => void;
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
}

interface MarkdownEditorProps {
  onDirtyChange: (dirty: boolean) => void;
  onDocumentChange: (outline: OutlineItem[], stats: DocStats) => void;
  onMarksChange: (marks: { bold: boolean; italic: boolean; code: boolean }) => void;
  onError: (message: string) => void;
}

function canonical(markdown: string): string {
  return markdown.replace(/\s+$/u, "");
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

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ onDirtyChange, onDocumentChange, onMarksChange, onError }, ref) {
    const baselineRef = useRef(canonical(WELCOME_MARKDOWN));
    const onDirtyRef = useRef(onDirtyChange);
    const onDocumentRef = useRef(onDocumentChange);
    const onMarksRef = useRef(onMarksChange);
    const onErrorRef = useRef(onError);
    const documentPathRef = useRef<string | null>(null);
    const insertFilesRef = useRef<(files: File[], pos?: number) => Promise<void>>(async () => {});
    const findIndexRef = useRef(0);
    const findMatchesRef = useRef<TextMatch[]>([]);
    const findingRef = useRef(false);
    onDirtyRef.current = onDirtyChange;
    onDocumentRef.current = onDocumentChange;
    onMarksRef.current = onMarksChange;
    onErrorRef.current = onError;

    const publish = (editor: Editor) => {
      onDocumentRef.current(collectOutline(editor.state.doc), documentStats(editor.getText()));
      onMarksRef.current({
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        code: editor.isActive("code"),
      });
    };

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          link: {
            openOnClick: false,
            autolink: true,
          },
        }),
        PreviewImage,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: "Start writing…",
        }),
        Markdown,
        FindReplace,
      ],
      content: WELCOME_MARKDOWN,
      contentType: "markdown",
      editorProps: {
        attributes: {
          spellcheck: "true",
          "aria-label": "Markdown document",
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
        baselineRef.current = canonical(created.getMarkdown());
        onDirtyRef.current(false);
        publish(created);
      },
      onUpdate: ({ editor: updated }) => {
        onDirtyRef.current(canonical(updated.getMarkdown()) !== baselineRef.current);
        publish(updated);
      },
      onSelectionUpdate: ({ editor: updated }) => {
        onMarksRef.current({
          bold: updated.isActive("bold"),
          italic: updated.isActive("italic"),
          code: updated.isActive("code"),
        });
      },
    });

    insertFilesRef.current = async (files: File[], pos?: number) => {
      if (!editor) return;
      const path = documentPathRef.current;
      if (!path) {
        throw new Error("Save the document before inserting an image.");
      }
      if (!isTauri()) {
        throw new Error("Image files are saved beside the document in the desktop app.");
      }
      if (pos != null) editor.commands.setTextSelection(pos);
      for (const file of files) {
        const name = file.name || `image.${extensionFor(file.type)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const saved = await savePastedImage(path, name, bytes);
        const markdown = `![${altFromRelative(saved.relativePath)}](${saved.relativePath})`;
        editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
      }
    };

    function runFind(query: string, caseSensitive: boolean, index: number): FindSnapshot {
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
        getMarkdown: () => editor?.getMarkdown() ?? "",
        setMarkdown: (markdown: string) => {
          if (!editor) return;
          editor.commands.setContent(markdown, {
            contentType: "markdown",
            emitUpdate: false,
          });
          clearFind(editor);
          findMatchesRef.current = [];
          findIndexRef.current = 0;
          baselineRef.current = canonical(editor.getMarkdown());
          onDirtyRef.current(false);
          publish(editor);
        },
        markSaved: () => {
          if (!editor) return;
          baselineRef.current = canonical(editor.getMarkdown());
          onDirtyRef.current(false);
        },
        focus: () => {
          editor?.commands.focus("end");
        },
        scrollToOutline: (pos: number) => {
          if (!editor) return;
          const dom = editor.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) {
            dom.scrollIntoView({ block: "start", behavior: "smooth" });
          }
          const target = Math.min(pos + 1, editor.state.doc.content.size);
          editor.chain().setTextSelection(target).focus().run();
        },
        toggleBold: () => {
          editor?.chain().focus().toggleBold().run();
        },
        toggleItalic: () => {
          editor?.chain().focus().toggleItalic().run();
        },
        toggleCode: () => {
          editor?.chain().focus().toggleCode().run();
        },
        getHTML: () => editor?.getHTML() ?? "",
        setDocumentPath: (path: string | null) => {
          documentPathRef.current = path;
        },
        setFindQuery: (query, caseSensitive) => runFind(query, caseSensitive, 0),
        findNext: (query, caseSensitive) => runFind(query, caseSensitive, findIndexRef.current + 1),
        findPrevious: (query, caseSensitive) =>
          runFind(query, caseSensitive, findIndexRef.current - 1),
        replaceCurrent: (query, replacement, caseSensitive) => {
          if (!editor || !query) return { count: 0, active: 0 };
          const current = findMatchesRef.current[findIndexRef.current];
          if (!current) return runFind(query, caseSensitive, 0);
          findingRef.current = true;
          try {
            replaceMatch(editor, current, replacement);
          } finally {
            findingRef.current = false;
          }
          return runFind(query, caseSensitive, findIndexRef.current);
        },
        replaceAll: (query, replacement, caseSensitive) => {
          if (!editor || !query) return { count: 0, active: 0 };
          const matches = findMatchesRef.current;
          if (matches.length === 0) return runFind(query, caseSensitive, 0);
          findingRef.current = true;
          try {
            replaceMatches(editor, matches, replacement);
          } finally {
            findingRef.current = false;
          }
          return runFind(query, caseSensitive, 0);
        },
        clearFind: () => {
          if (!editor) return;
          clearFind(editor);
          findMatchesRef.current = [];
          findIndexRef.current = 0;
        },
        insertImageFiles: (files, pos) => insertFilesRef.current(files, pos),
        insertImageFromDialog: async () => {
          if (!editor) return false;
          const path = documentPathRef.current;
          if (!path) throw new Error("Save the document before inserting an image.");
          const saved = await pickAndSaveImage(path);
          if (!saved) return false;
          const markdown = `![${altFromRelative(saved.relativePath)}](${saved.relativePath})`;
          editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
          return true;
        },
      }),
      [editor],
    );

    return <EditorContent editor={editor} id="write" />;
  },
);

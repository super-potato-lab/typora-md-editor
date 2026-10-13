import { forwardRef, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { WELCOME_MARKDOWN } from "./welcome";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  markSaved: () => void;
  focus: () => void;
}

interface MarkdownEditorProps {
  onDirtyChange: (dirty: boolean) => void;
}

function canonical(markdown: string): string {
  return markdown.replace(/\s+$/u, "");
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ onDirtyChange }, ref) {
    const baselineRef = useRef(canonical(WELCOME_MARKDOWN));
    const onDirtyRef = useRef(onDirtyChange);
    onDirtyRef.current = onDirtyChange;

    const syncDirty = (editor: Editor) => {
      onDirtyRef.current(canonical(editor.getMarkdown()) !== baselineRef.current);
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
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: "Start writing…",
        }),
        Markdown,
      ],
      content: WELCOME_MARKDOWN,
      contentType: "markdown",
      editorProps: {
        attributes: {
          spellcheck: "true",
          "aria-label": "Markdown document",
        },
      },
      onCreate: ({ editor: created }) => {
        baselineRef.current = canonical(created.getMarkdown());
        onDirtyRef.current(false);
      },
      onUpdate: ({ editor: updated }) => {
        syncDirty(updated);
      },
    });

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
          baselineRef.current = canonical(editor.getMarkdown());
          onDirtyRef.current(false);
        },
        markSaved: () => {
          if (!editor) return;
          baselineRef.current = canonical(editor.getMarkdown());
          onDirtyRef.current(false);
        },
        focus: () => {
          editor?.commands.focus("end");
        },
      }),
      [editor],
    );

    return <EditorContent editor={editor} id="write" />;
  },
);

import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { FindReplace } from "./find";
import { FootnoteDefinition, FootnoteReference } from "./footnotes";
import { HeadingAnchor } from "./headingAnchor";
import { createMathExtensions, type MathEditHandlers } from "./mathExtensions";
import { MermaidBlock } from "./mermaid";
import { PreviewImage } from "./PreviewImage";

export function createEditorExtensions(
  handlers: MathEditHandlers = {},
  placeholder: () => string = () => "Start writing…",
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
    HeadingAnchor,
    PreviewImage,
    TaskList,
    TaskItem.configure({ nested: true }),
    ...createMathExtensions(handlers),
    MermaidBlock,
    FootnoteReference,
    FootnoteDefinition,
    Placeholder.configure({
      placeholder,
    }),
    Markdown,
    FindReplace,
  ];
}

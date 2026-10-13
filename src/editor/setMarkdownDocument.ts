import type { Editor, JSONContent } from "@tiptap/core";

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === "paragraph" && (node.content?.length ?? 0) === 0;
}

/** Markdown for save and source sync. Skips the caret paragraph TrailingNode adds after a non-paragraph block. */
export function editorMarkdown(editor: Editor): string {
  const json = editor.getJSON();
  const content = json.content;
  if (content && content.length >= 2) {
    const last = content[content.length - 1];
    const previous = content[content.length - 2];
    if (isEmptyParagraph(last) && previous?.type !== "paragraph" && editor.markdown) {
      return editor.markdown.serialize({ type: "doc", content: content.slice(0, -1) });
    }
  }
  return editor.getMarkdown();
}

export function setMarkdownDocument(editor: Editor, markdown: string, emitUpdate = false): void {
  const parsed = editor.markdown?.parse(markdown);
  editor.commands.setContent(parsed ?? markdown, { emitUpdate });
}

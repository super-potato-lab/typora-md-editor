import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { setMarkdownDocument } from "./setMarkdownDocument";

/**
 * Replace the open document and drop undo history.
 * setContent alone keeps the previous file's history, so Undo can paste that
 * file back into the path the user just opened.
 */
export function loadMarkdownDocument(editor: Editor, markdown: string): void {
  setMarkdownDocument(editor, markdown, false);
  const next = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
    schema: editor.state.schema,
  });
  editor.view.updateState(next);
}

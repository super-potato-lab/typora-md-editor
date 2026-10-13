import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "./extensions";

export function mountEditor(markdown = ""): { editor: Editor; unmount: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  return {
    editor,
    unmount() {
      editor.destroy();
      element.remove();
    },
  };
}

import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createEditorExtensions } from "./extensions";
import { headingIdAppendTransaction } from "./headingAnchor";
import { editorMarkdown, setMarkdownDocument } from "./setMarkdownDocument";

const editors: Editor[] = [];

function mount(markdown: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

function setComposing(editor: Editor, composing: boolean): void {
  (editor.view as unknown as { input: { composing: boolean } }).input.composing = composing;
}

function firstHeadingEnd(editor: Editor): number {
  let end = 1;
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== "heading") return;
    end = pos + node.nodeSize - 1;
    found = true;
  });
  return end;
}

function firstHeading(editor: Editor): { id: unknown; text: string } {
  let found: { id: unknown; text: string } | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && !found) {
      found = { id: node.attrs.id, text: node.textContent };
    }
  });
  if (!found) throw new Error("expected a heading");
  return found;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.innerHTML = "";
});

describe("headingIdAppendTransaction", () => {
  it("returns null while composing so the heading text node is left alone", async () => {
    const editor = mount("# Title\n");
    await settle();
    const tr = editor.state.tr.insertText("你", firstHeadingEnd(editor)).setMeta("composition", 1);
    // `tr.doc` is the stepped document before appendTransaction, so the
    // heading id is still the pre-composition slug.
    const stepped = EditorState.create({ schema: editor.schema, doc: tr.doc });
    let steppedHeading: { id: unknown; text: string } | null = null;
    stepped.doc.descendants((node) => {
      if (node.type.name === "heading" && !steppedHeading) {
        steppedHeading = { id: node.attrs.id, text: node.textContent };
      }
    });
    expect(steppedHeading).toEqual({ id: "title", text: "Title你" });
    expect(headingIdAppendTransaction([tr], stepped, true)).toBeNull();

    const update = headingIdAppendTransaction([tr], stepped, false);
    expect(update?.getMeta("headingIds")).toBe(true);
    expect(update?.getMeta("addToHistory")).toBe(false);
    const applied = stepped.apply(update!);
    let id: unknown = null;
    applied.doc.descendants((node) => {
      if (node.type.name === "heading") id = node.attrs.id;
    });
    expect(id).toBe("title你");
    expect(headingIdAppendTransaction([update!], applied, false)).toBeNull();
  });

  it("returns null when the document did not change", async () => {
    const editor = mount("# Title\n");
    await settle();
    const tr = editor.state.tr.setMeta("pointer", true);
    expect(headingIdAppendTransaction([tr], editor.state, false)).toBeNull();
  });
});

describe("heading IME", () => {
  it("does not rewrite heading ids during composition, then updates them after compositionend", async () => {
    const editor = mount("# Title\n\n## Already\n");
    await settle();
    expect(firstHeading(editor)).toEqual({ id: "title", text: "Title" });

    setComposing(editor, true);
    editor.view.dispatch(editor.state.tr.insertText("你", firstHeadingEnd(editor)).setMeta("composition", 1));
    expect(firstHeading(editor)).toEqual({ id: "title", text: "Title你" });

    editor.view.dom.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await settle();
    expect(firstHeading(editor)).toEqual({ id: "title你", text: "Title你" });

    const markdown = editorMarkdown(editor);
    expect(markdown).toContain("Title你");
    setMarkdownDocument(editor, markdown);
    await settle();
    expect(editorMarkdown(editor)).toBe(markdown);
    expect(firstHeading(editor)).toEqual({ id: "title你", text: "Title你" });
  });

  it("keeps updating heading ids for ordinary English typing", async () => {
    const editor = mount("# Title\n");
    await settle();
    setComposing(editor, false);
    editor.view.dispatch(editor.state.tr.insertText("s", firstHeadingEnd(editor)));
    expect(firstHeading(editor)).toEqual({ id: "titles", text: "Titles" });
  });

  it("lets a composition-tagged transaction refresh ids once composing is over", async () => {
    const editor = mount("# Title\n");
    await settle();
    setComposing(editor, false);
    editor.view.dispatch(editor.state.tr.insertText("s", firstHeadingEnd(editor)).setMeta("composition", 1));
    expect(firstHeading(editor)).toEqual({ id: "titles", text: "Titles" });
  });

  it("accepts IME text in an empty heading created from a heading node", async () => {
    const editor = mount("");
    editor.commands.setContent("<h2></h2>");
    await settle();
    expect(firstHeading(editor)).toEqual({ id: "untitled", text: "" });

    setComposing(editor, true);
    editor.view.dispatch(editor.state.tr.insertText("你好", firstHeadingEnd(editor)));
    expect(firstHeading(editor)).toEqual({ id: "untitled", text: "你好" });

    editor.view.dom.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await settle();
    expect(firstHeading(editor)).toEqual({ id: "你好", text: "你好" });
  });
});

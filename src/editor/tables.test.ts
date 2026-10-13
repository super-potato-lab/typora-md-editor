import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { loadMarkdownDocument } from "./loadDocument";
import { mountEditor } from "./mountEditor";

const TABLE = ["| Name | Qty |", "| --- | --- |", "| Apples | 2 |", "| Pears | 5 |", ""].join("\n");

function cellTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      texts.push(node.textContent);
    }
  });
  return texts;
}

describe("markdown tables", () => {
  let unmount = () => {};

  afterEach(() => {
    unmount();
  });

  it("keeps a GFM table when a file is opened and serialized again", () => {
    const mounted = mountEditor("placeholder");
    unmount = mounted.unmount;
    loadMarkdownDocument(mounted.editor, TABLE);

    expect(cellTexts(mounted.editor)).toEqual(["Name", "Qty", "Apples", "2", "Pears", "5"]);

    const saved = mounted.editor.getMarkdown();
    expect(saved).toContain("Apples");
    expect(saved).toContain("Pears");
    expect(saved).toMatch(/\|/);

    loadMarkdownDocument(mounted.editor, saved);
    expect(cellTexts(mounted.editor)).toEqual(["Name", "Qty", "Apples", "2", "Pears", "5"]);
    expect(mounted.editor.getMarkdown()).toBe(saved);
  });

  it("keeps an image link through the same document load", () => {
    const mounted = mountEditor("hello");
    unmount = mounted.unmount;
    loadMarkdownDocument(mounted.editor, "See ![diagram](assets/diagram.png) here.\n");
    expect(mounted.editor.getMarkdown()).toContain("![diagram](assets/diagram.png)");
  });
});

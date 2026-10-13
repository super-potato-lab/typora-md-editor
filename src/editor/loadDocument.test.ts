import { afterEach, describe, expect, it } from "vitest";
import { loadMarkdownDocument } from "./loadDocument";
import { mountEditor } from "./mountEditor";

describe("loadMarkdownDocument", () => {
  let unmount = () => {};

  afterEach(() => {
    unmount();
  });

  it("drops undo history so the previous file cannot be restored", () => {
    const mounted = mountEditor("first document");
    unmount = mounted.unmount;
    const editor = mounted.editor;
    editor.commands.insertContent(" extra");
    expect(editor.can().undo()).toBe(true);

    loadMarkdownDocument(editor, "second document");
    expect(editor.can().undo()).toBe(false);
    expect(editor.commands.undo()).toBe(false);
    expect(editor.getText()).toContain("second document");
    expect(editor.getText()).not.toContain("first");

    editor.commands.insertContent(" plus");
    expect(editor.can().undo()).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toContain("second document");
    expect(editor.getText()).not.toContain("plus");
    expect(editor.getText()).not.toContain("first");
  });
});

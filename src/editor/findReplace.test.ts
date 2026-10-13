import { afterEach, describe, expect, it } from "vitest";
import { findInString, replaceAllMatches, replaceCurrentMatch, spliceMatches } from "./find";
import { mountEditor } from "./mountEditor";

function text(editor: { getText: () => string }): string {
  return editor.getText().replace(/\s+/gu, " ").trim();
}

describe("find and replace", () => {
  let unmount = () => {};

  afterEach(() => {
    unmount();
  });

  it("maps adjacent matches when the replacement changes length", () => {
    const mounted = mountEditor("aa");
    unmount = mounted.unmount;
    replaceAllMatches(mounted.editor, "a", "xy", false);
    expect(text(mounted.editor)).toBe("xyxy");
  });

  it("recomputes matches after an edit instead of using stale positions", () => {
    const mounted = mountEditor("hello world hello");
    unmount = mounted.unmount;
    const editor = mounted.editor;
    editor.view.dispatch(editor.state.tr.insertText("X", 1));
    expect(text(editor)).toBe("Xhello world hello");

    replaceAllMatches(editor, "hello", "hey", false);
    expect(text(editor)).toBe("Xhey world hey");
  });

  it("replaces the current match using positions from the edited document", () => {
    const mounted = mountEditor("one one");
    unmount = mounted.unmount;
    const editor = mounted.editor;
    editor.view.dispatch(editor.state.tr.insertText("X", 1));
    replaceCurrentMatch(editor, "one", "TWO", false, 1);
    expect(text(editor)).toBe("Xone TWO");
  });

  it("maps matches when the replacement is shorter than the query", () => {
    const mounted = mountEditor("xyxy");
    unmount = mounted.unmount;
    replaceAllMatches(mounted.editor, "xy", "q", false);
    expect(text(mounted.editor)).toBe("qq");
  });

  it("recomputes source matches after an edit before splicing", () => {
    const edited = "Xhello world hello";
    const stale = findInString("hello world hello", "hello", false);
    expect(edited.slice(stale[0]!.from, stale[0]!.to)).not.toBe("hello");
    const fresh = findInString(edited, "hello", false);
    expect(spliceMatches(edited, fresh, "hey")).toBe("Xhey world hey");
  });

  it("honors case sensitivity when replacing every match", () => {
    const mounted = mountEditor("Hello hello");
    unmount = mounted.unmount;
    replaceAllMatches(mounted.editor, "hello", "yo", true);
    expect(text(mounted.editor)).toBe("Hello yo");
  });
});

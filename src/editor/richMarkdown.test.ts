import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { renderRichHtml } from "./exportHtml";
import { createEditorExtensions } from "./extensions";
import { nextFootnoteId } from "./footnotes";
import { matchBlockMathInput, matchInlineMathInput } from "./mathInput";
import { collectOutlineFromMarkdown } from "./outline";
import { editorMarkdown, setMarkdownDocument } from "./setMarkdownDocument";
import { tableOfContentsMarkdown, uniqueSlug } from "./slug";
import { WELCOME_MARKDOWN } from "./welcome";

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

function attrs(editor: Editor, type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) found.push({ ...node.attrs });
  });
  return found;
}

function typeChar(editor: Editor, text: string): boolean {
  editor.commands.focus("end");
  const from = editor.state.selection.from;
  return (
    editor.view.someProp(
      "handleTextInput",
      (fn) => fn(editor.view, from, from, text, () => editor.state.tr) === true,
    ) === true
  );
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.innerHTML = "";
});

describe("markdown syntax", () => {
  it("round-trips the welcome document", async () => {
    const editor = mount(WELCOME_MARKDOWN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const once = editorMarkdown(editor);
    editor.commands.setContent(once, { contentType: "markdown" });
    expect(editorMarkdown(editor)).toBe(once);
    expect(attrs(editor, "inlineMath").map((item) => item.latex)).toEqual(["E = mc^2"]);
    expect(attrs(editor, "blockMath").map((item) => item.latex)).toEqual(["\\int_0^1 x^2 \\, dx"]);
    expect(String(attrs(editor, "mermaid")[0]?.code)).toContain("flowchart LR");
    expect(attrs(editor, "footnoteReference").map((item) => item.noteId)).toEqual(["1"]);
    expect(attrs(editor, "footnoteDefinition")[0]).toMatchObject({
      noteId: "1",
      text: "The note is stored as Markdown and shown under the reference.",
    });
    const html = editor.getHTML();
    expect(html).toContain('id="math"');
    expect(html).toContain('id="diagram"');
    const rich = await renderRichHtml(html);
    expect(rich).toContain("katex");
    expect(rich).toContain("flowchart LR");
  });

  it("keeps ordinary code, prices, and inline double dollars as text", () => {
    const editor = mount(
      ["The price is $5 and $10 today.", "", "Energy $$E=mc^2$$ stays inline.", "", "`$x$`", "", "```ts", "const n = 1", "```"].join(
        "\n",
      ),
    );
    expect(attrs(editor, "inlineMath")).toEqual([]);
    expect(attrs(editor, "blockMath")).toEqual([]);
    expect(attrs(editor, "mermaid")).toEqual([]);
    expect(attrs(editor, "codeBlock")).toEqual([{ language: "ts" }]);
    expect(editor.getText()).toContain("$5 and $10");
    expect(editor.getText()).toContain("$$E=mc^2$$");
  });

  it("parses a one-line block formula and a multiline footnote", () => {
    const editor = mount(["$$E = mc^2$$", "", "See [^note].", "", "[^note]: First line", "    second line"].join("\n"));
    expect(attrs(editor, "blockMath")).toEqual([{ latex: "E = mc^2" }]);
    expect(attrs(editor, "footnoteDefinition")[0]?.text).toBe("First line\nsecond line");
    const again = editorMarkdown(editor);
    setMarkdownDocument(editor, again);
    expect(editorMarkdown(editor)).toBe(again);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.content.size).toBe(0);
  });

  it("turns typed dollars into math nodes", () => {
    const inline = mount("");
    inline.commands.setContent("<p>$E = mc^2</p>");
    expect(typeChar(inline, "$")).toBe(true);
    expect(attrs(inline, "inlineMath")).toEqual([{ latex: "E = mc^2" }]);

    const block = mount("");
    block.commands.setContent("<p>$$E = mc^2$</p>");
    expect(typeChar(block, "$")).toBe(true);
    expect(attrs(block, "blockMath")).toEqual([{ latex: "E = mc^2" }]);
  });
});

describe("contents and footnotes", () => {
  it("builds a stable heading list and skips fenced headings", () => {
    const markdown = ["```", "# Hidden", "```", "", "# Real", "", "## Real"].join("\n");
    const outline = collectOutlineFromMarkdown(markdown);
    expect(outline.map((item) => item.text)).toEqual(["Real", "Real"]);
    const seen = new Map<string, number>();
    expect(outline.map((item) => uniqueSlug(item.text, seen))).toEqual(["real", "real-1"]);
    expect(tableOfContentsMarkdown(outline)).toBe(["**Contents**", "", "- [Real](#real)", "  - [Real](#real-1)"].join("\n"));
    expect(nextFootnoteId("Already [^1] and [^a].")).toBe("2");
  });

  it("inserts a table of contents that points at heading ids", async () => {
    const editor = mount("# Alpha\n\n## Beta\n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.commands.focus("end");
    editor.commands.insertContent(`${tableOfContentsMarkdown(collectOutlineFromMarkdown(editor.getMarkdown()))}\n\n`, {
      contentType: "markdown",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const html = editor.getHTML();
    expect(html).toContain('href="#alpha"');
    expect(html).toContain('href="#beta"');
    expect(html).toContain('id="alpha"');
    expect(html).toContain('id="beta"');
  });
});

describe("math matchers", () => {
  it("accepts inline and block delimiters", () => {
    expect(matchInlineMathInput("Energy $E = mc^2$")?.data).toEqual({ latex: "E = mc^2" });
    expect(matchInlineMathInput("$5 and $10")).toBeNull();
    expect(matchInlineMathInput("$$E = mc^2$$")).toBeNull();
    expect(matchBlockMathInput("$$E = mc^2$$")?.data).toEqual({ latex: "E = mc^2" });
    expect(matchBlockMathInput("see $$E = mc^2$$")).toBeNull();
  });
});

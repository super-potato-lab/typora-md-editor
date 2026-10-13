import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { codeLowlight } from "./codeHighlight";
import { createEditorExtensions } from "./extensions";
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

describe("fenced code highlighting", () => {
  it("registers the common fence languages", () => {
    for (const name of [
      "javascript",
      "js",
      "jsx",
      "typescript",
      "ts",
      "tsx",
      "python",
      "py",
      "rust",
      "go",
      "java",
      "c",
      "cpp",
      "c++",
      "csharp",
      "cs",
      "html",
      "xml",
      "css",
      "scss",
      "json",
      "yaml",
      "yml",
      "toml",
      "bash",
      "shell",
      "sh",
      "sql",
      "markdown",
      "md",
      "php",
      "ruby",
      "swift",
      "kotlin",
      "plaintext",
      "text",
    ]) {
      expect(codeLowlight.registered(name), name).toBe(true);
    }
    expect(codeLowlight.registered("mermaid")).toBe(false);
  });

  it("keeps the language on a fence and colors the code", () => {
    const source = [
      "```python",
      "def hello():",
      "    return 'ok'",
      "```",
      "",
      "```js",
      "const value = 1;",
      "```",
      "",
      "```tsx",
      "type Item = { n: number };",
      "```",
      "",
      "```",
      "not highlighted",
      "```",
    ].join("\n");
    const editor = mount(source);
    expect(attrs(editor, "codeBlock")).toEqual([
      { language: "python" },
      { language: "js" },
      { language: "tsx" },
      { language: null },
    ]);
    expect(attrs(editor, "mermaid")).toEqual([]);

    const labeled = [...editor.view.dom.querySelectorAll("pre[data-language]")].map((node) =>
      node.getAttribute("data-language"),
    );
    expect(labeled).toEqual(["python", "js", "tsx"]);
    const python = editor.view.dom.querySelector("pre[data-language='python']");
    expect(python?.textContent).toContain("def hello():");
    expect(python?.querySelector(".hljs-keyword")).not.toBeNull();
    expect(python?.querySelector(".hljs-string")?.textContent).toContain("ok");
    const plain = [...editor.view.dom.querySelectorAll("pre")].find(
      (node) => !node.hasAttribute("data-language") && node.textContent?.includes("not highlighted"),
    );
    expect(plain?.querySelector("[class*='hljs-']")).toBeNull();

    const again = editorMarkdown(editor);
    expect(again).toContain("```python\ndef hello():\n    return 'ok'\n```");
    expect(again).toContain("```js\nconst value = 1;\n```");
    expect(again).toContain("```tsx\ntype Item = { n: number };\n```");
    expect(again).toContain("```\nnot highlighted\n```");
    setMarkdownDocument(editor, again);
    expect(editorMarkdown(editor)).toBe(again);
    expect(attrs(editor, "codeBlock").map((item) => item.language)).toEqual(["python", "js", "tsx", null]);
  });

  it("leaves mermaid fences as diagrams", () => {
    const source = ["```mermaid", "flowchart LR", "  A --> B", "```", "", "```python", "x = 1", "```"].join("\n");
    const editor = mount(source);
    expect(attrs(editor, "mermaid").map((item) => item.code)).toEqual(["flowchart LR\n  A --> B"]);
    expect(attrs(editor, "codeBlock")).toEqual([{ language: "python" }]);
    expect(editor.view.dom.querySelector("[data-type='mermaid']")).not.toBeNull();
    expect(editor.view.dom.querySelector("pre[data-language='mermaid']")).toBeNull();
    const again = editorMarkdown(editor);
    expect(again).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(again).toContain("```python\nx = 1\n```");
    setMarkdownDocument(editor, again);
    expect(attrs(editor, "mermaid")).toHaveLength(1);
    expect(attrs(editor, "codeBlock")).toEqual([{ language: "python" }]);
  });

  it("types a language fence as code and a mermaid fence as a diagram", () => {
    const python = mount("");
    python.commands.setContent("<p>```python</p>");
    expect(typeChar(python, " ")).toBe(true);
    expect(attrs(python, "codeBlock")).toEqual([{ language: "python" }]);
    expect(python.view.dom.querySelector("pre[data-language='python']")).not.toBeNull();

    const diagram = mount("");
    diagram.commands.setContent("<p>```mermaid</p>");
    expect(typeChar(diagram, " ")).toBe(true);
    expect(attrs(diagram, "mermaid")).toEqual([{ code: "" }]);
    expect(attrs(diagram, "codeBlock")).toEqual([]);
  });
});

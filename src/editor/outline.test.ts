import { describe, expect, it } from "vitest";
import { activeHeadingPos, collectOutlineFromMarkdown, documentStats } from "./outline";

describe("activeHeadingPos", () => {
  const markdown = ["Intro line", "", "# Title", "", "Body", "", "## Section", "", "More", ""].join("\n");
  const items = collectOutlineFromMarkdown(markdown);

  it("follows the heading that contains the caret", () => {
    expect(items.map((item) => item.text)).toEqual(["Title", "Section"]);
    expect(activeHeadingPos(items, 0)).toBeNull();
    expect(activeHeadingPos(items, items[0]!.pos)).toBe(items[0]!.pos);
    expect(activeHeadingPos(items, items[1]!.pos - 1)).toBe(items[0]!.pos);
    expect(activeHeadingPos(items, items[1]!.pos)).toBe(items[1]!.pos);
    expect(activeHeadingPos(items, markdown.length)).toBe(items[1]!.pos);
  });

  it("returns null when the document has no headings", () => {
    expect(activeHeadingPos([], 0)).toBeNull();
  });
});

describe("documentStats", () => {
  it("counts Han characters and Latin words together", () => {
    expect(documentStats("")).toEqual({ words: 0, chars: 0 });
    expect(documentStats("  ")).toEqual({ words: 0, chars: 2 });
    expect(documentStats("hello world")).toEqual({ words: 2, chars: 11 });
    expect(documentStats("你好世界")).toEqual({ words: 4, chars: 4 });
    expect(documentStats("hello 世界")).toEqual({ words: 3, chars: 8 });
    expect(documentStats("你好，世界")).toEqual({ words: 4, chars: 5 });
  });
});

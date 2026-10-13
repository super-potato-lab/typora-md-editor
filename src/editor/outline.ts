import type { Node as ProseNode } from "@tiptap/pm/model";
import { headingLabel } from "./slug";

export interface OutlineItem {
  pos: number;
  level: number;
  text: string;
}

export interface DocStats {
  words: number;
  chars: number;
}

export function collectOutline(doc: ProseNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level) || 1;
    const text = node.textContent.trim();
    items.push({ pos, level, text });
  });
  return items;
}

export function collectOutlineFromMarkdown(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  let fence: "`" | "~" | null = null;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.replace(/\r$/u, "");
    const opener = /^( {0,3})(```+|~~~+)/.exec(line);
    if (opener?.[2]) {
      const marker = opener[2].startsWith("`") ? "`" : "~";
      fence = !fence ? marker : fence === marker ? null : fence;
    } else if (!fence) {
      const heading = /^(#{1,6})[ \t]+(\S.*)$/.exec(line);
      if (heading?.[1] && heading[2]) {
        items.push({
          pos: offset,
          level: heading[1].length,
          text: headingLabel(heading[2]),
        });
      }
    }
    offset += rawLine.length + 1;
  }
  return items;
}

/** Heading that contains `caret`, assuming `items` are in document order. */
export function activeHeadingPos(items: OutlineItem[], caret: number): number | null {
  let active: number | null = null;
  for (const item of items) {
    if (item.pos <= caret) active = item.pos;
    else break;
  }
  return active;
}

/**
 * Simple mixed Chinese/English count: each Han character is a word, and the
 * remaining letters and numbers are split on whitespace.
 */
export function documentStats(text: string): DocStats {
  const trimmed = text.trim();
  if (!trimmed) return { words: 0, chars: text.length };
  let words = 0;
  const rest = trimmed.replace(/\p{Script=Han}+/gu, (run) => {
    words += run.length;
    return " ";
  });
  const tokens = rest.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (tokens) words += tokens.split(/\s+/u).length;
  return { words, chars: text.length };
}

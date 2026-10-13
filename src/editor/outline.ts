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

export function documentStats(text: string): DocStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  return { words, chars: text.length };
}

import type { Node as ProseNode } from "@tiptap/pm/model";

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

export function documentStats(text: string): DocStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  return { words, chars: text.length };
}

import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface TextMatch {
  from: number;
  to: number;
}

export interface FindSnapshot {
  count: number;
  active: number;
}

const findPluginKey = new PluginKey<DecorationSet>("findReplace");

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(findPluginKey) as DecorationSet | undefined;
            if (next) return next;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return findPluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

interface Span {
  start: number;
  from: number;
  text: string;
}

export function findMatches(doc: ProseNode, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    matches.push(...matchesInTextblock(node, pos, needle, caseSensitive));
    return false;
  });
  return matches;
}

function matchesInTextblock(
  block: ProseNode,
  blockPos: number,
  needle: string,
  caseSensitive: boolean,
): TextMatch[] {
  const spans: Span[] = [];
  let haystack = "";
  // Positions from Node.descendants are relative to this block's content.
  block.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    spans.push({ start: haystack.length, from: blockPos + 1 + pos, text: node.text });
    haystack += node.text;
  });
  if (haystack.length < needle.length) return [];

  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const matches: TextMatch[] = [];
  let index = 0;
  while (index <= hay.length - needle.length) {
    const found = hay.indexOf(needle, index);
    if (found < 0) break;
    const from = positionAt(spans, found, "start");
    const to = positionAt(spans, found + needle.length, "end");
    if (from != null && to != null && to > from) {
      matches.push({ from, to });
    }
    index = found + needle.length;
  }
  return matches;
}

function positionAt(spans: Span[], index: number, side: "start" | "end"): number | null {
  for (const span of spans) {
    const end = span.start + span.text.length;
    if (side === "start") {
      // A shared boundary belongs to the next text node, so a match is not
      // pinned to the end of the previous run.
      if (index >= span.start && index < end) {
        return span.from + (index - span.start);
      }
    } else if (index > span.start && index <= end) {
      return span.from + (index - span.start);
    }
  }
  return null;
}

function decorate(doc: ProseNode, matches: TextMatch[], active: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === active ? "find-match active" : "find-match",
      }),
    ),
  );
}

export function resolveMatchIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function findInString(text: string, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  let index = 0;
  while (needle.length > 0 && index <= hay.length - needle.length) {
    const found = hay.indexOf(needle, index);
    if (found < 0) break;
    matches.push({ from: found, to: found + needle.length });
    index = found + needle.length;
  }
  return matches;
}

export function spliceMatches(text: string, matches: TextMatch[], replacement: string): string {
  let next = text;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (!match) continue;
    next = next.slice(0, match.from) + replacement + next.slice(match.to);
  }
  return next;
}

export function showFind(
  editor: Editor,
  query: string,
  caseSensitive: boolean,
  activeIndex: number,
): { matches: TextMatch[]; index: number; snapshot: FindSnapshot } {
  const matches = findMatches(editor.state.doc, query, caseSensitive);
  const index = resolveMatchIndex(activeIndex, matches.length);
  let tr = editor.state.tr.setMeta(findPluginKey, decorate(editor.state.doc, matches, index));
  const current = matches[index];
  if (current) {
    tr = tr.setSelection(TextSelection.create(tr.doc, current.from, current.to)).scrollIntoView();
  }
  editor.view.dispatch(tr);
  return {
    matches,
    index,
    snapshot: { count: matches.length, active: matches.length ? index + 1 : 0 },
  };
}

export function clearFind(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, DecorationSet.empty));
}

export function replaceMatch(editor: Editor, match: TextMatch, replacement: string): void {
  editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to));
}

export function replaceMatches(editor: Editor, matches: TextMatch[], replacement: string): void {
  let tr = editor.state.tr;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (!match) continue;
    tr = tr.insertText(replacement, match.from, match.to);
  }
  editor.view.dispatch(tr);
}

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

function findMatches(doc: ProseNode, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const spans: Span[] = [];
  let haystack = "";
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    spans.push({ start: haystack.length, from: pos, text: node.text });
    haystack += node.text;
  });

  const needle = caseSensitive ? query : query.toLowerCase();
  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const matches: TextMatch[] = [];
  let index = 0;
  while (needle.length > 0 && index <= hay.length - needle.length) {
    const found = hay.indexOf(needle, index);
    if (found < 0) break;
    const from = positionAt(spans, found);
    const to = positionAt(spans, found + needle.length);
    if (from != null && to != null && to > from && sameBlock(doc, from, to)) {
      matches.push({ from, to });
    }
    index = found + needle.length;
  }
  return matches;
}

function positionAt(spans: Span[], index: number): number | null {
  for (const span of spans) {
    const end = span.start + span.text.length;
    if (index >= span.start && index <= end) {
      return span.from + (index - span.start);
    }
  }
  return null;
}

function sameBlock(doc: ProseNode, from: number, to: number): boolean {
  try {
    return doc.resolve(from).sameParent(doc.resolve(to - 1));
  } catch {
    return false;
  }
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

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export function showFind(
  editor: Editor,
  query: string,
  caseSensitive: boolean,
  activeIndex: number,
): { matches: TextMatch[]; index: number; snapshot: FindSnapshot } {
  const matches = findMatches(editor.state.doc, query, caseSensitive);
  const index = clampIndex(activeIndex, matches.length);
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

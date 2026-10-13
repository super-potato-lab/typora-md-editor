import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { headingLabel, uniqueSlug } from "./slug";

export function headingIdTransaction(state: EditorState): Transaction | null {
  const seen = new Map<string, number>();
  const updates: { pos: number; attrs: Record<string, unknown> }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const id = uniqueSlug(headingLabel(node.textContent), seen);
    if (node.attrs.id === id) return;
    updates.push({ pos, attrs: { ...node.attrs, id } });
  });
  if (updates.length === 0) return null;
  let tr = state.tr;
  for (const update of updates) {
    tr = tr.setNodeMarkup(update.pos, undefined, update.attrs);
  }
  return tr.setMeta("headingIds", true).setMeta("addToHistory", false);
}

export const HeadingAnchor = Extension.create({
  name: "headingAnchor",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("id"),
            renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta("headingIds"))) return null;
          return headingIdTransaction(state);
        },
      }),
    ];
  },

  onCreate() {
    const editor = this.editor;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      const tr = headingIdTransaction(editor.state);
      if (!tr) return;
      editor.view.dispatch(tr);
    });
  },
});

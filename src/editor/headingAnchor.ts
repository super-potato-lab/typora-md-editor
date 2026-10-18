import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
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

/**
 * Heading id updates call `setNodeMarkup`. A changed `id` fails ProseMirror's
 * `sameMarkup` check, so the heading DOM node is recreated. Doing that while
 * `view.composing` is true replaces the text node the IME is writing into
 * and Chinese (and other CJK) input in headings never completes.
 *
 * Pass `view.composing`. While it is true — which covers the transactions
 * ProseMirror tags with `composition` during the composition — this returns
 * null. After `compositionend`, `view.composing` is false, so the next
 * document change refreshes ids. The compositionend handler also schedules
 * a refresh when that final change never arrives.
 */
export function headingIdAppendTransaction(
  transactions: readonly Transaction[],
  state: EditorState,
  composing: boolean,
): Transaction | null {
  if (composing) return null;
  if (!transactions.some((tr) => tr.docChanged)) return null;
  if (transactions.some((tr) => tr.getMeta("headingIds"))) return null;
  return headingIdTransaction(state);
}

function scheduleHeadingIdsAfterComposition(view: EditorView): void {
  // ProseMirror clears `view.composing` in its own compositionend handler,
  // which runs after plugin handlers, and may flush the DOM in a microtask.
  // A macrotask sees the committed heading text. If that flush already
  // refreshed ids, this dispatch is a no-op.
  setTimeout(() => {
    if (view.isDestroyed || view.composing) return;
    const tr = headingIdTransaction(view.state);
    if (!tr) return;
    view.dispatch(tr);
  }, 0);
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
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            compositionend: (view) => {
              scheduleHeadingIdsAfterComposition(view);
              return false;
            },
          },
        },
        appendTransaction(transactions, _old, state) {
          return headingIdAppendTransaction(transactions, state, editor.view.composing);
        },
      }),
    ];
  },

  onCreate() {
    const editor = this.editor;
    queueMicrotask(() => {
      if (editor.isDestroyed || editor.view.composing) return;
      const tr = headingIdTransaction(editor.state);
      if (!tr) return;
      editor.view.dispatch(tr);
    });
  },
});

import { InputRule } from "@tiptap/core";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { blockMathLookahead, matchBlockMathInput, matchInlineMathInput, tokenizeBlockMath, tokenizeInlineMath } from "./mathInput";

export interface MathEditHandlers {
  onEditInlineMath?: (latex: string, pos: number) => void;
  onEditBlockMath?: (latex: string, pos: number) => void;
}

const InlineDollarMath = InlineMath.extend({
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (src: string) => src.indexOf("$"),
    tokenize: (src: string) => tokenizeInlineMath(src),
  },

  addInputRules() {
    return [
      new InputRule({
        find: matchInlineMathInput,
        handler: ({ state, range, match }) => {
          const latex = match.data?.latex;
          if (typeof latex !== "string" || !latex) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

const BlockDollarMath = BlockMath.extend({
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: blockMathLookahead,
    tokenize: (src: string) => tokenizeBlockMath(src),
  },

  addInputRules() {
    return [
      new InputRule({
        find: matchBlockMathInput,
        handler: ({ state, range, match }) => {
          const latex = match.data?.latex;
          if (typeof latex !== "string" || !latex) return null;
          const { tr } = state;
          const $from = state.doc.resolve(range.from);
          const node = this.type.create({ latex });
          const consumesHostTextblock =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end();
          const canReplaceHostTextblock =
            consumesHostTextblock &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type);
          const replacementRange = canReplaceHostTextblock
            ? { from: $from.before(), to: $from.after() }
            : range;
          tr.replaceWith(replacementRange.from, replacementRange.to, node);
        },
      }),
    ];
  },
});

function latexOf(node: ProseNode): string {
  return typeof node.attrs.latex === "string" ? node.attrs.latex : "";
}

export function createMathExtensions(handlers: MathEditHandlers = {}) {
  return [
    InlineDollarMath.configure({
      katexOptions: { throwOnError: false, displayMode: false },
      onClick: handlers.onEditInlineMath
        ? (node, pos) => handlers.onEditInlineMath?.(latexOf(node), pos)
        : undefined,
    }),
    BlockDollarMath.configure({
      katexOptions: { throwOnError: false, displayMode: true },
      onClick: handlers.onEditBlockMath
        ? (node, pos) => handlers.onEditBlockMath?.(latexOf(node), pos)
        : undefined,
    }),
  ];
}

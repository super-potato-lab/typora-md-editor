import type { InputRuleMatch } from "@tiptap/core";

export function matchInlineMathInput(text: string): InputRuleMatch | null {
  const match = /(^|[^$])\$([^$\n]+)\$$/.exec(text);
  if (!match) return null;
  const latex = match[2] ?? "";
  if (!latex.trim() || latex.startsWith(" ") || latex.endsWith(" ")) return null;
  const prefix = match[1] ?? "";
  const openIndex = match.index + prefix.length;
  return { index: openIndex, text: `$${latex}$`, data: { latex } };
}

export function matchBlockMathInput(text: string): InputRuleMatch | null {
  const match = /^\$\$([^$\n]+)\$\$$/.exec(text);
  if (!match) return null;
  const latex = (match[1] ?? "").trim();
  if (!latex) return null;
  return { index: 0, text: match[0], data: { latex } };
}

export interface MarkdownTokenish {
  type: string;
  raw: string;
  latex?: string;
  [key: string]: unknown;
}

export function tokenizeBlockMath(src: string): MarkdownTokenish | undefined {
  const fence = /^\$\$[ \t]*\r?\n([\s\S]*?)^\$\$[ \t]*(?:\r?\n|$)/m.exec(src);
  if (fence && fence.index === 0) {
    return {
      type: "blockMath",
      raw: fence[0],
      latex: (fence[1] ?? "").trim(),
    };
  }
  const oneLine = /^\$\$([^\r\n$]+)\$\$[ \t]*(?:\r?\n|$)/.exec(src);
  if (!oneLine) return undefined;
  return {
    type: "blockMath",
    raw: oneLine[0],
    latex: (oneLine[1] ?? "").trim(),
  };
}

export function blockMathLookahead(src: string): number {
  const re = /(?:^|\n)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const index = match.index + (src[match.index] === "\n" ? 1 : 0);
    if (tokenizeBlockMath(src.slice(index))) return index;
  }
  return -1;
}

export function tokenizeInlineMath(src: string): MarkdownTokenish | undefined {
  if (src.startsWith("$$") || src.startsWith("\\$")) return undefined;
  const match = /^\$([^$\s](?:[^$\n]*[^$\s])?)\$(?!\$)/.exec(src);
  if (!match) return undefined;
  const latex = match[1] ?? "";
  if (!latex) return undefined;
  return { type: "inlineMath", raw: match[0], latex };
}

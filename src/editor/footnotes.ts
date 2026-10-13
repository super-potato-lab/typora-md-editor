import { mergeAttributes, Node } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { safeDomId } from "./slug";
import { subscribeLocale, t } from "../i18n/locale.ts";

function noteIdOf(node: { attrs?: { noteId?: unknown } | null }): string {
  return typeof node.attrs?.noteId === "string" ? node.attrs.noteId : "";
}

function noteTextOf(node: { attrs?: { text?: unknown } | null }): string {
  return typeof node.attrs?.text === "string" ? node.attrs.text : "";
}

function tokenizeFootnoteDefinition(src: string): { type: string; raw: string; id: string; text: string } | undefined {
  const first = /^\[\^([^\]]+)\]:[ \t]*([^\n\r]*)(?:\r?\n|$)/.exec(src);
  if (!first) return undefined;
  let raw = first[0];
  const lines = [first[2] ?? ""];
  let rest = src.slice(raw.length);
  while (rest.length > 0) {
    const cont = /^(?:[ \t]{2,}|\t)([^\n\r]*)(?:\r?\n|$)/.exec(rest);
    if (!cont) break;
    raw += cont[0];
    lines.push(cont[1] ?? "");
    rest = rest.slice(cont[0].length);
  }
  const text = lines.join("\n").replace(/\s+$/u, "");
  return {
    type: "footnoteDefinition",
    raw,
    id: first[1] ?? "",
    text,
  };
}

function footnoteDefinitionLookahead(src: string): number {
  const re = /(?:^|\n)\[\^[^\]]+\]:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const index = match.index + (src[match.index] === "\n" ? 1 : 0);
    if (tokenizeFootnoteDefinition(src.slice(index))) return index;
  }
  return -1;
}

function tokenizeFootnoteReference(src: string): { type: string; raw: string; id: string } | undefined {
  const match = /^\[\^([^\]]+)\]/.exec(src);
  if (!match) return undefined;
  if (src[match[0].length] === ":") return undefined;
  return { type: "footnoteReference", raw: match[0], id: match[1] ?? "" };
}

function renderDefinition(text: string, id: string): string {
  const lines = text.split("\n");
  const [first, ...rest] = lines;
  return [`[^${id}]: ${first ?? ""}`, ...rest.map((line) => `    ${line}`)].join("\n");
}

function definitionView({ node, editor, getPos }: NodeViewRendererProps) {
  let current = node;
  const dom = document.createElement("div");
  dom.className = "footnote-definition";
  dom.setAttribute("data-type", "footnote-definition");
  const label = document.createElement("span");
  label.className = "footnote-label";
  const body = document.createElement("textarea");
  body.className = "footnote-body";
  body.spellcheck = true;
  body.setAttribute("aria-label", t("footnote.aria"));
  body.rows = 2;

  function syncDom() {
    const id = noteIdOf(current);
    dom.id = `fn-${safeDomId(id)}`;
    label.textContent = `[^${id}]`;
    body.setAttribute("aria-label", t("footnote.aria"));
    if (body.value !== noteTextOf(current) && document.activeElement !== body) {
      body.value = noteTextOf(current);
    }
  }

  body.addEventListener("input", () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const text = body.value;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, text }),
    );
  });

  dom.append(label, body);
  syncDom();
  const unsubscribe = subscribeLocale(syncDom);

  return {
    dom,
    stopEvent(event: Event) {
      const target = event.target;
      return target instanceof HTMLElement && Boolean(target.closest("textarea"));
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      unsubscribe();
    },
    update(next: ProseNode) {
      if (next.type.name !== "footnoteDefinition") return false;
      current = next;
      syncDom();
      return true;
    },
  };
}

function referenceView({ node }: NodeViewRendererProps) {
  let current = node;
  const dom = document.createElement("sup");
  dom.className = "footnote-ref";
  dom.setAttribute("data-type", "footnote-ref");
  const anchor = document.createElement("a");
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    const id = `fn-${safeDomId(noteIdOf(current))}`;
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  function syncDom() {
    const id = noteIdOf(current);
    anchor.href = `#fn-${safeDomId(id)}`;
    anchor.textContent = id;
  }
  dom.append(anchor);
  syncDom();
  return {
    dom,
    update(next: ProseNode) {
      if (next.type.name !== "footnoteReference") return false;
      current = next;
      syncDom();
      return true;
    },
  };
}

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-note-id"),
        renderHTML: (attributes) => ({ "data-note-id": attributes.noteId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-type='footnote-ref']" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = noteIdOf(node);
    const domId = safeDomId(id);
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { "data-type": "footnote-ref", "data-note-id": id }),
      ["a", { href: `#fn-${domId}` }, id],
    ];
  },

  parseMarkdown: (token) => ({
    type: "footnoteReference",
    attrs: { noteId: String(token.id ?? "") },
  }),

  renderMarkdown: (node) => `[^${noteIdOf(node)}]`,

  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start: (src: string) => src.indexOf("[^"),
    tokenize: (src: string) => tokenizeFootnoteReference(src),
  },

  addNodeView() {
    return (props) => referenceView(props);
  },
});

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-note-id"),
        renderHTML: (attributes) => ({ "data-note-id": attributes.noteId }),
      },
      text: {
        default: "",
        parseHTML: (element) => element.querySelector("span")?.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='footnote-definition']" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = noteIdOf(node);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote-definition",
        "data-note-id": id,
        id: `fn-${safeDomId(id)}`,
        class: "footnote-definition",
      }),
      ["span", { class: "footnote-label" }, `[^${id}]`],
      ["span", { class: "footnote-body" }, noteTextOf(node)],
    ];
  },

  parseMarkdown: (token) => ({
    type: "footnoteDefinition",
    attrs: {
      noteId: String(token.id ?? ""),
      text: typeof token.text === "string" ? token.text : "",
    },
  }),

  renderMarkdown: (node) => renderDefinition(noteTextOf(node), noteIdOf(node)),

  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start: footnoteDefinitionLookahead,
    tokenize: (src: string) => tokenizeFootnoteDefinition(src),
  },

  addNodeView() {
    return (props) => definitionView(props);
  },
});

export function nextFootnoteId(markdown: string): string {
  const used = new Set<string>();
  for (const match of markdown.matchAll(/\[\^([^\]]+)\]/g)) {
    if (match[1]) used.add(match[1]);
  }
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

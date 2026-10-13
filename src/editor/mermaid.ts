import { mergeAttributes, Node, nodeInputRule } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import type { NodeViewRendererProps } from "@tiptap/core";
import { subscribeLocale, t } from "../i18n/locale.ts";

const MERMAID_SAMPLE = "flowchart LR\n  A[Start] --> B[Done]";

function tokenizeMermaid(src: string): { type: string; raw: string; code: string } | undefined {
  const match = /^```mermaid[ \t]*\r?\n([\s\S]*?)```[ \t]*(?:\r?\n|$)/.exec(src);
  if (!match) return undefined;
  return {
    type: "mermaid",
    raw: match[0],
    code: (match[1] ?? "").replace(/\s+$/u, ""),
  };
}

function mermaidLookahead(src: string): number {
  const re = /(?:^|\n)```mermaid(?:[ \t]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const index = match.index + (src[match.index] === "\n" ? 1 : 0);
    if (tokenizeMermaid(src.slice(index))) return index;
  }
  return -1;
}

function codeOf(node: { attrs?: { code?: unknown } | null }): string {
  return typeof node.attrs?.code === "string" ? node.attrs.code : "";
}

function renderMermaidView(props: NodeViewRendererProps) {
  const { editor, getPos } = props;
  let current = props.node;
  const dom = document.createElement("div");
  dom.className = "mermaid-block";
  dom.setAttribute("data-type", "mermaid");

  const canvas = document.createElement("div");
  canvas.className = "mermaid-canvas";
  const error = document.createElement("pre");
  error.className = "mermaid-error";
  error.hidden = true;
  const source = document.createElement("textarea");
  source.className = "mermaid-source";
  source.spellcheck = false;
  source.hidden = true;
  source.setAttribute("aria-label", t("mermaid.source"));
  source.value = codeOf(current);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "mermaid-edit";
  let editing = false;
  let renderToken = 0;
  let drawnCode = "";
  let renderChain = Promise.resolve();

  function draw() {
    const token = ++renderToken;
    renderChain = renderChain
      .then(() => renderDiagram(token))
      .catch(() => {
        // The next draw() reports its own error.
      });
  }

  async function renderDiagram(token: number) {
    if (token !== renderToken) return;
    const code = codeOf(current);
    if (canvas.querySelector("svg") && drawnCode === code) return;
    error.hidden = true;
    error.textContent = "";
    if (!code.trim() || import.meta.env.MODE === "test") {
      canvas.innerHTML = "";
      drawnCode = code;
      const pre = document.createElement("pre");
      pre.className = "mermaid";
      pre.textContent = code;
      canvas.append(pre);
      return;
    }
    try {
      const mermaid = (await import("mermaid")).default;
      if (token !== renderToken) return;
      const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: dark ? "dark" : "default",
      });
      const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
      const rendered = await mermaid.render(id, code);
      if (token !== renderToken) return;
      canvas.innerHTML = rendered.svg;
      drawnCode = code;
      const leftover = document.getElementById(id);
      if (leftover && !canvas.contains(leftover)) leftover.remove();
    } catch (err) {
      if (token !== renderToken) return;
      canvas.innerHTML = "";
      drawnCode = "";
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : t("mermaid.error");
    }
  }

  edit.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (editing) {
      const pos = getPos();
      if (typeof pos === "number") {
        const next = source.value.replace(/\s+$/u, "");
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, code: next }),
        );
      }
    }
    editing = !editing;
    source.hidden = !editing;
    canvas.hidden = editing;
    error.hidden = editing || !error.textContent;
    edit.textContent = editing ? t("mermaid.done") : t("mermaid.edit");
    if (editing) source.focus();
    else void draw();
  });

  source.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = source.selectionStart;
      const end = source.selectionEnd;
      source.setRangeText("  ", start, end, "end");
    }
  });

  function labels() {
    source.setAttribute("aria-label", t("mermaid.source"));
    edit.textContent = editing ? t("mermaid.done") : t("mermaid.edit");
  }
  labels();
  const unsubscribe = subscribeLocale(labels);

  dom.append(canvas, error, source, edit);
  void draw();

  return {
    dom,
    stopEvent(event: Event) {
      const target = event.target;
      return target instanceof HTMLElement && Boolean(target.closest("textarea, button"));
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      unsubscribe();
    },
    update(node: ProseNode) {
      if (node.type.name !== "mermaid") return false;
      current = node;
      if (!editing && source.value !== codeOf(node)) source.value = codeOf(node);
      if (!editing) void draw();
      return true;
    },
  };
}

export const MermaidBlock = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      code: {
        default: MERMAID_SAMPLE,
        parseHTML: (element) => element.querySelector("pre")?.textContent ?? "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "mermaid", class: "mermaid-block" }),
      ["pre", { class: "mermaid" }, codeOf(node)],
    ];
  },

  parseMarkdown: (token) => ({
    type: "mermaid",
    attrs: { code: typeof token.code === "string" ? token.code : "" },
  }),

  renderMarkdown: (node) => {
    const code = codeOf(node).replace(/\s+$/u, "");
    return `\`\`\`mermaid\n${code}\n\`\`\``;
  },

  markdownTokenizer: {
    name: "mermaid",
    level: "block",
    start: mermaidLookahead,
    tokenize: (src: string) => tokenizeMermaid(src),
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^```mermaid[\s\n]$/,
        type: this.type,
        getAttributes: () => ({ code: "" }),
      }),
    ];
  },

  addNodeView() {
    return (props) => renderMermaidView(props);
  },
});

export const MERMAID_TEMPLATE = `\`\`\`mermaid\n${MERMAID_SAMPLE}\n\`\`\`\n`;

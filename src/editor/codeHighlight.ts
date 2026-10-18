import { mergeAttributes, textblockTypeInputRule } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { t } from "../i18n/locale.ts";

const lowlight = createLowlight();

function register(name: string, grammar: LanguageFn, aliases: string[] = []): void {
  lowlight.register(name, grammar);
  const missing = aliases.filter((alias) => alias !== name && !lowlight.registered(alias));
  if (missing.length > 0) lowlight.registerAlias({ [name]: missing });
}

register("javascript", javascript, ["js", "jsx"]);
register("typescript", typescript, ["ts", "tsx"]);
register("python", python, ["py"]);
register("rust", rust, ["rs"]);
register("go", go, ["golang"]);
register("java", java);
register("c", c);
register("cpp", cpp, ["c++", "cc", "hpp"]);
register("csharp", csharp, ["cs", "c#"]);
register("xml", xml, ["html"]);
register("css", css);
register("scss", scss);
register("json", json);
register("yaml", yaml, ["yml"]);
register("ini", ini, ["toml"]);
register("bash", bash, ["sh", "shell", "zsh"]);
register("sql", sql);
register("markdown", markdown, ["md"]);
register("php", php);
register("ruby", ruby, ["rb"]);
register("swift", swift);
register("kotlin", kotlin, ["kt"]);
register("plaintext", plaintext, ["text", "txt", "plain"]);

// Unlabeled fences and unknown names stay plain. Guessing a language would
// color ```mermaid when that fence is still a code block, and it would color
// fences the author left unmarked.
lowlight.highlightAuto = (value: string) => lowlight.highlight("plaintext", value);

export const codeLowlight = lowlight;

/** Names shown in the code-block language picker (aliases included). */
export const CODE_LANGUAGE_HINTS = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "html",
  "ini",
  "java",
  "javascript",
  "js",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "md",
  "php",
  "plaintext",
  "py",
  "python",
  "rb",
  "ruby",
  "rust",
  "scss",
  "sh",
  "shell",
  "sql",
  "swift",
  "text",
  "ts",
  "tsx",
  "typescript",
  "xml",
  "yaml",
  "yml",
] as const;

const fenceLanguage = "([A-Za-z0-9_+#-]*)";
const notMermaid = String.raw`(?!mermaid(?:[\s\n]|$))`;

function languageOf(node: ProseNode): string {
  return typeof node.attrs.language === "string" ? node.attrs.language : "";
}

function normalizeLanguage(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Mermaid fences are a separate node type; keep this a plain code block.
  if (trimmed.toLowerCase() === "mermaid") return null;
  return trimmed;
}

function syncLanguageDom(pre: HTMLElement, code: HTMLElement, language: string, prefix: string): void {
  if (language) {
    pre.setAttribute("data-language", language);
    code.className = `${prefix}${language}`;
  } else {
    pre.removeAttribute("data-language");
    code.removeAttribute("class");
  }
}

function renderCodeBlockView(props: NodeViewRendererProps) {
  const { editor, getPos, extension } = props;
  let current = props.node;
  const prefix = extension.options.languageClassPrefix ?? "language-";

  const dom = document.createElement("pre");
  dom.className = "code-block";

  const content = document.createElement("code");
  content.spellcheck = false;

  const bar = document.createElement("div");
  bar.className = "code-language-bar";
  bar.contentEditable = "false";

  const listId = `code-lang-${Math.random().toString(36).slice(2, 10)}`;
  const list = document.createElement("datalist");
  list.id = listId;
  for (const name of CODE_LANGUAGE_HINTS) {
    const option = document.createElement("option");
    option.value = name;
    list.append(option);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "code-language-input";
  input.setAttribute("list", listId);
  input.setAttribute("aria-label", t("code.language"));
  input.placeholder = t("code.languagePlaceholder");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = languageOf(current);

  syncLanguageDom(dom, content, languageOf(current), prefix);

  function applyLanguage(raw: string): void {
    const next = normalizeLanguage(raw);
    const pos = getPos();
    if (typeof pos !== "number") return;
    if ((current.attrs.language ?? null) === next) {
      input.value = next ?? "";
      return;
    }
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        language: next,
      }),
    );
  }

  input.addEventListener("change", () => applyLanguage(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLanguage(input.value);
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = languageOf(current);
      input.blur();
    }
  });
  input.addEventListener("blur", () => applyLanguage(input.value));

  bar.append(input, list);
  dom.append(content, bar);

  return {
    dom,
    contentDOM: content,
    update(updated: ProseNode) {
      if (updated.type !== current.type) return false;
      current = updated;
      const language = languageOf(current);
      if (document.activeElement !== input) input.value = language;
      syncLanguageDom(dom, content, language, prefix);
      input.setAttribute("aria-label", t("code.language"));
      input.placeholder = t("code.languagePlaceholder");
      return true;
    },
    ignoreMutation(mutation: MutationRecord | { type: string; target: Node }) {
      const target = mutation.target;
      if (!(target instanceof Node)) return false;
      return bar.contains(target);
    },
    stopEvent(event: Event) {
      const target = event.target;
      return target instanceof Node && bar.contains(target);
    },
  };
}

export const HighlightedCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent!(),
      lowlight,
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
    const prefix = this.options.languageClassPrefix ?? "language-";
    return [
      "pre",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        { class: "code-block" },
        language ? { "data-language": language } : {},
      ),
      [
        "code",
        {
          class: language ? `${prefix}${language}` : null,
        },
        0,
      ],
    ];
  },

  parseMarkdown(token, helpers) {
    if (token.lang === "mermaid") {
      const text = typeof token.text === "string" ? token.text : "";
      return {
        type: "mermaid",
        attrs: { code: text.replace(/\s+$/u, "") },
      };
    }
    const parent = this.parent;
    return parent ? parent(token, helpers) : [];
  },

  addInputRules() {
    const fence = (mark: "`" | "~") =>
      textblockTypeInputRule({
        find: new RegExp(`^${mark}{3}${notMermaid}${fenceLanguage}[\\s\\n]$`),
        type: this.type,
        getAttributes: (match) => ({
          language: match[1] || null,
        }),
      });
    return [fence("`"), fence("~")];
  },

  addNodeView() {
    return (props) => renderCodeBlockView(props);
  },
});

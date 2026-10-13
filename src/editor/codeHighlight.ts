import { mergeAttributes, textblockTypeInputRule } from "@tiptap/core";
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

const fenceLanguage = "([A-Za-z0-9_+#-]*)";
const notMermaid = String.raw`(?!mermaid(?:[\s\n]|$))`;

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
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, language ? { "data-language": language } : {}),
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
});

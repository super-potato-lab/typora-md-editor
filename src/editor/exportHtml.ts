import contentCss from "../styles/content.css?raw";
import { themeCss } from "../themes";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildExportHtml(options: {
  title: string;
  bodyHtml: string;
  themeId: string;
}): string {
  const theme = themeCss(options.themeId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <style>
${contentCss}
${theme}
html, body { margin: 0; background: var(--bg-color); color: var(--text-color); }
#write { padding: 2.5rem 1.5rem 4rem; }
  </style>
</head>
<body>
  <article id="write">
${options.bodyHtml}
  </article>
</body>
</html>
`;
}

export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print preview");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const frame = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!frame || !doc) {
    iframe.remove();
    throw new Error("Could not open the print view.");
  }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    frame.focus();
    frame.print();
    window.setTimeout(() => iframe.remove(), 1000);
  }, 200);
}

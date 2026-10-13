import contentCss from "../styles/content.css?raw";
import { themeCss } from "../themes";
import { rewriteImgSrcs } from "./imagePaths";
import { displayImageSrc } from "./imageSrc";

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

export function buildPrintHtml(options: {
  title: string;
  bodyHtml: string;
  themeId: string;
  documentDir: string | null;
}): string {
  const bodyHtml = rewriteImgSrcs(options.bodyHtml, (src) =>
    displayImageSrc(src, options.documentDir),
  );
  return buildExportHtml({
    title: options.title,
    bodyHtml,
    themeId: options.themeId,
  });
}

export async function printHtml(html: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print preview");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "800px";
  iframe.style.height = "1056px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
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
  try {
    await waitForImages(doc);
    frame.focus();
    frame.print();
  } finally {
    window.setTimeout(() => iframe.remove(), 1000);
  }
}

function waitForImages(doc: Document): Promise<void> {
  const images = [...doc.images];
  return Promise.all(images.map((img) => withTimeout(imageReady(img), 10000))).then(
    () => undefined,
  );
}

function imageReady(img: HTMLImageElement): Promise<void> {
  if (!img.getAttribute("src")) return Promise.resolve();
  const decoded = img.decode?.();
  if (decoded) {
    return decoded.catch(() => waitForLoad(img));
  }
  return waitForLoad(img);
}

function waitForLoad(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    if (img.complete) done();
  });
}

function withTimeout(pending: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    void pending.finally(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

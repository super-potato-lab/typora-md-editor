export function isExternalImageSrc(src: string): boolean {
  return /^(?:https?:|data:|blob:|asset:|tauri:|file:|mailto:)/iu.test(src) || src.startsWith("//");
}

export function isAbsoluteFsPath(src: string): boolean {
  return src.startsWith("/") || src.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(src);
}

export function joinDocumentPath(directory: string, relative: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  const normalized = separator === "\\" ? relative.replaceAll("/", "\\") : relative.replaceAll("\\", "/");
  if (!directory) return normalized;
  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return `${directory}${normalized}`;
  }
  return `${directory}${separator}${normalized}`;
}

export function resolveLocalImagePath(stored: string, directory: string | null): string | null {
  if (!stored || isExternalImageSrc(stored)) return null;
  if (isAbsoluteFsPath(stored)) return stored;
  if (!directory) return null;
  return joinDocumentPath(directory, stored);
}

export function localImageSrc(
  stored: string,
  directory: string | null,
  toAssetUrl: (absolutePath: string) => string,
): string {
  const absolute = resolveLocalImagePath(stored, directory);
  if (!absolute) return stored;
  try {
    return toAssetUrl(absolute);
  } catch {
    return stored;
  }
}

export function rewriteImgSrcs(html: string, mapSrc: (src: string) => string): string {
  return html.replace(/<img\b[^>]*>/giu, (tag) => rewriteImgTag(tag, mapSrc));
}

function rewriteImgTag(tag: string, mapSrc: (src: string) => string): string {
  return tag.replace(
    /(\ssrc\s*=\s*)(["'])([\s\S]*?)\2/giu,
    (full, prefix: string, quote: string, src: string) => {
      const decoded = decodeHtmlAttr(src);
      const next = mapSrc(decoded);
      if (next === decoded) return full;
      return `${prefix}${quote}${escapeHtmlAttr(next)}${quote}`;
    },
  );
}

function decodeHtmlAttr(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeHtmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

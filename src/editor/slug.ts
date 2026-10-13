export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function uniqueSlug(label: string, seen: Map<string, number>): string {
  const base = slugify(label) || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function headingLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed || "Untitled";
}

export interface TocHeading {
  level: number;
  text: string;
}

export function tableOfContentsMarkdown(headings: TocHeading[]): string {
  if (headings.length === 0) return "";
  const min = Math.min(...headings.map((heading) => heading.level));
  const seen = new Map<string, number>();
  const lines = ["**Contents**", ""];
  for (const heading of headings) {
    const label = headingLabel(heading.text);
    const slug = uniqueSlug(label, seen);
    const indent = "  ".repeat(Math.max(0, heading.level - min));
    const visible = label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    lines.push(`${indent}- [${visible}](#${slug})`);
  }
  return lines.join("\n");
}

export function safeDomId(value: string): string {
  const encoded = encodeURIComponent(value).replace(/%/g, "_");
  return encoded || "section";
}

export interface ThemeInfo {
  id: string;
  label: string;
  href: string;
}

const LABELS: Record<string, string> = {
  github: "GitHub",
  night: "Night",
};

const PREFERRED_ORDER = ["github", "night"];
const STORAGE_KEY = "markdown-editor.theme";
const THEME_LINK_ID = "theme_css";

const themeHrefs = import.meta.glob("../themes/*.css", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const themeSources = import.meta.glob("../themes/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function labelFor(id: string): string {
  return LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function idFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.css$/u, "");
}

export const themes: ThemeInfo[] = Object.entries(themeHrefs)
  .map(([path, href]) => {
    const id = idFromPath(path);
    return { id, label: labelFor(id), href };
  })
  .sort((a, b) => {
    const ai = PREFERRED_ORDER.indexOf(a.id);
    const bi = PREFERRED_ORDER.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

export function themeCss(id: string): string {
  const entry = Object.entries(themeSources).find(([path]) => idFromPath(path) === id);
  return entry?.[1] ?? "";
}

export function readSavedTheme(): string {
  const fallback = themes.find((theme) => theme.id === "github")?.id ?? themes[0]?.id ?? "github";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && themes.some((theme) => theme.id === saved)) return saved;
  } catch {
    /* private mode */
  }
  return fallback;
}

export function applyTheme(id: string): string {
  const theme = themes.find((item) => item.id === id) ?? themes[0];
  const resolved = theme?.id ?? "github";
  const href = theme?.href;
  if (href) {
    let link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = THEME_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) {
      link.href = href;
    }
  }
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {
    /* ignore quota / private mode */
  }
  return resolved;
}

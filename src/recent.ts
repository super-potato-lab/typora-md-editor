import { basename } from "./files";

const STORAGE_KEY = "markdown-editor.recent";
const MAX_RECENT = 10;

export interface RecentFile {
  path: string;
  openedAt: number;
}

export function readRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentFile).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecent(path: string): RecentFile[] {
  const next = [
    { path, openedAt: Date.now() },
    ...readRecent().filter((item) => item.path !== path),
  ].slice(0, MAX_RECENT);
  writeRecent(next);
  return next;
}

export function forgetRecent(path: string): RecentFile[] {
  const next = readRecent().filter((item) => item.path !== path);
  writeRecent(next);
  return next;
}

export function recentName(path: string): string {
  return basename(path);
}

function writeRecent(items: RecentFile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota / private mode */
  }
}

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentFile>;
  return typeof item.path === "string" && typeof item.openedAt === "number";
}

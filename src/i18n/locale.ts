import { catalogs, type Locale, type MessageKey } from "./messages.ts";

export const LOCALE_KEY = "locale";
export const DEFAULT_LOCALE: Locale = "zh-CN";

const listeners = new Set<() => void>();
let current: Locale = DEFAULT_LOCALE;

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function getLocale(): Locale {
  return current;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSavedLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* private mode or unavailable storage */
  }
  return DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): Locale {
  current = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* ignore quota / private mode */
  }
  for (const listener of listeners) listener();
  return current;
}

export function applySavedLocale(): Locale {
  return setLocale(readSavedLocale());
}

export function formatMessage(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return formatMessage(catalogs[current][key], vars);
}

export function themeName(id: string, fallback: string): string {
  if (id === "github") return t("theme.github");
  if (id === "night") return t("theme.night");
  return fallback;
}

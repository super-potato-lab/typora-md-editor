import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribeLocale, t } from "./locale.ts";

export { localizeError } from "./errors.ts";
export {
  applySavedLocale,
  DEFAULT_LOCALE,
  getLocale,
  LOCALE_KEY,
  readSavedLocale,
  setLocale,
  t,
  themeName,
} from "./locale.ts";
export { catalogs, en, zhCN, type Locale, type MessageKey } from "./messages.ts";

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { locale, setLocale, t };
}

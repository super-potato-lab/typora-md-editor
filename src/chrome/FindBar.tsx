import { useEffect, type RefObject } from "react";
import { useI18n } from "../i18n";

interface FindBarProps {
  query: string;
  replacement: string;
  count: number;
  active: number;
  caseSensitive: boolean;
  findInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  focusReplace: boolean;
  focusToken: number;
  onQuery: (value: string) => void;
  onReplacement: (value: string) => void;
  onCase: (value: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function FindBar({
  query,
  replacement,
  count,
  active,
  caseSensitive,
  findInputRef,
  replaceInputRef,
  focusReplace,
  focusToken,
  onQuery,
  onReplacement,
  onCase,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: FindBarProps) {
  const { t } = useI18n();
  useEffect(() => {
    const node = focusReplace ? replaceInputRef.current : findInputRef.current;
    node?.focus();
    node?.select();
  }, [focusReplace, focusToken, findInputRef, replaceInputRef]);

  return (
    <form
      className="find-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          onPrev();
        }
      }}
    >
      <input
        ref={findInputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={t("find.placeholder")}
        aria-label={t("find.placeholder")}
      />
      <input
        ref={replaceInputRef}
        value={replacement}
        onChange={(event) => onReplacement(event.target.value)}
        placeholder={t("find.replace")}
        aria-label={t("find.replace")}
      />
      <label className="find-case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => onCase(event.target.checked)}
        />
        {t("find.matchCase")}
      </label>
      <span className="find-count">{count ? `${active} / ${count}` : t("find.noMatches")}</span>
      <button type="button" onClick={onPrev}>
        {t("find.prev")}
      </button>
      <button type="submit">{t("find.next")}</button>
      <button type="button" onClick={onReplace}>
        {t("find.replaceAction")}
      </button>
      <button type="button" onClick={onReplaceAll}>
        {t("find.all")}
      </button>
      <button type="button" onClick={onClose}>
        {t("find.close")}
      </button>
    </form>
  );
}

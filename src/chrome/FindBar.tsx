import { useEffect, type RefObject } from "react";

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
        placeholder="Find"
        aria-label="Find"
      />
      <input
        ref={replaceInputRef}
        value={replacement}
        onChange={(event) => onReplacement(event.target.value)}
        placeholder="Replace"
        aria-label="Replace"
      />
      <label className="find-case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => onCase(event.target.checked)}
        />
        Match case
      </label>
      <span className="find-count">{count ? `${active} / ${count}` : "No matches"}</span>
      <button type="button" onClick={onPrev}>
        Prev
      </button>
      <button type="submit">Next</button>
      <button type="button" onClick={onReplace}>
        Replace
      </button>
      <button type="button" onClick={onReplaceAll}>
        All
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </form>
  );
}

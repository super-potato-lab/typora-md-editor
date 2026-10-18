export interface SaveSnapshot {
  path: string | null;
  markdown: string;
}

/** Ignore trailing whitespace so it does not toggle the dirty flag. */
export function canonicalMarkdown(markdown: string): string {
  return markdown.replace(/\s+$/u, "");
}

/**
 * A save may finish after the user keeps typing or opens another file.
 * Only the snapshot taken when that save started may clear the dirty flag.
 */
export function savedSnapshotStillCurrent(snapshot: SaveSnapshot, current: SaveSnapshot): boolean {
  return (
    snapshot.path === current.path &&
    canonicalMarkdown(snapshot.markdown) === canonicalMarkdown(current.markdown)
  );
}

/**
 * Untitled documents have no path. Save must open the location picker
 * and must not write a markdown file until the user chooses one.
 * Blank strings count as untitled so a write is never aimed at "".
 */
export function documentNeedsSaveLocation(
  path: string | null | undefined,
): path is null | undefined {
  return typeof path !== "string" || path.trim() === "";
}

/**
 * The Save As dialog already wrote the file. Repeat that write only when
 * an older save of the same path is still queued and could finish last.
 */
export function saveAsNeedsRewrite(followsQueuedWrite: boolean): boolean {
  return followsQueuedWrite;
}

export interface SaveSerializer {
  /**
   * Queue `task` after any in-flight save of `path`.
   * `followsQueuedWrite` is true when another save of this path was still
   * queued. A write that already landed (the Save As dialog) has to be
   * repeated after that older save, or the older save can overwrite it.
   */
  enqueue(path: string, task: (followsQueuedWrite: boolean) => Promise<void>): Promise<void>;
}

/**
 * Saves of one path run in order. A later save waits for the earlier write
 * so an older request cannot finish last and overwrite newer contents.
 * A failed save does not block the next one. Other paths stay independent.
 */
export function createSaveSerializer(): SaveSerializer {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue(path, task) {
      const previous = tails.get(path);
      const followsQueuedWrite = previous !== undefined;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(path, gate);
      const run = (previous ?? Promise.resolve()).then(
        () => task(followsQueuedWrite),
        () => task(followsQueuedWrite),
      );
      // Drop the slot as soon as the write settles, before the caller
      // continues, so a later Save As is not treated as queued behind a
      // write that has already finished.
      void run.then(
        () => {
          if (tails.get(path) === gate) tails.delete(path);
          release();
        },
        () => {
          if (tails.get(path) === gate) tails.delete(path);
          release();
        },
      );
      return run;
    },
  };
}

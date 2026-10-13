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

export interface SaveSerializer {
  enqueue(path: string, task: () => Promise<void>): Promise<void>;
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
      const previous = tails.get(path) ?? Promise.resolve();
      const run = previous.then(task, task);
      const settled = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(path, settled);
      void settled.finally(() => {
        if (tails.get(path) === settled) tails.delete(path);
      });
      return run;
    },
  };
}

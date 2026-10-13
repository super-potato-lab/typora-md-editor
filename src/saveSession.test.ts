import { describe, expect, it } from "vitest";
import { canonicalMarkdown, createSaveSerializer, savedSnapshotStillCurrent } from "./saveSession";

describe("savedSnapshotStillCurrent", () => {
  it("accepts the same path and content", () => {
    const snapshot = { path: "/notes/a.md", markdown: "hello\n" };
    expect(savedSnapshotStillCurrent(snapshot, { path: "/notes/a.md", markdown: "hello\n" })).toBe(true);
  });

  it("treats trailing whitespace as unchanged", () => {
    const snapshot = { path: "/notes/a.md", markdown: "hello\n" };
    expect(savedSnapshotStillCurrent(snapshot, { path: "/notes/a.md", markdown: "hello\n\n" })).toBe(
      true,
    );
    expect(canonicalMarkdown("hello\n\n")).toBe("hello");
  });

  it("rejects edits made while the save was in flight", () => {
    const snapshot = { path: "/notes/a.md", markdown: "hello" };
    expect(savedSnapshotStillCurrent(snapshot, { path: "/notes/a.md", markdown: "hello!" })).toBe(
      false,
    );
  });

  it("rejects a different open path", () => {
    const snapshot = { path: "/notes/a.md", markdown: "hello" };
    expect(savedSnapshotStillCurrent(snapshot, { path: "/notes/b.md", markdown: "hello" })).toBe(
      false,
    );
  });
});

describe("createSaveSerializer", () => {
  it("runs saves of one path in order and lets another path proceed", async () => {
    const { enqueue } = createSaveSerializer();
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = enqueue("a.md", async () => {
      order.push("a-start");
      await gate;
      order.push("a-end");
    });
    const second = enqueue("a.md", async () => {
      order.push("a-next");
    });
    const other = enqueue("b.md", async () => {
      order.push("b");
    });

    await other;
    expect(order).toEqual(["a-start", "b"]);
    release();
    await first;
    await second;
    expect(order).toEqual(["a-start", "b", "a-end", "a-next"]);
  });

  it("continues the queue after a failed save", async () => {
    const { enqueue } = createSaveSerializer();
    const seen: string[] = [];
    await expect(
      enqueue("a.md", async () => {
        throw new Error("disk");
      }),
    ).rejects.toThrow("disk");
    await enqueue("a.md", async () => {
      seen.push("next");
    });
    expect(seen).toEqual(["next"]);
  });
});

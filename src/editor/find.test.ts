import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema, type Node as ProseNode } from "@tiptap/pm/model";
import { findMatches } from "./find.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline" },
  },
  marks: {
    bold: {},
  },
});

function doc(...blocks: ProseNode[]): ProseNode {
  return schema.node("doc", null, blocks);
}

function paragraph(...content: ProseNode[]): ProseNode {
  return schema.node("paragraph", null, content);
}

function textAt(root: ProseNode, value: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  root.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const index = node.text.indexOf(value);
    if (index >= 0) found = { from: pos + index, to: pos + index + value.length };
  });
  if (!found) throw new Error(`missing text ${value}`);
  return found;
}

test("finds a match at the start of a later paragraph", () => {
  const root = doc(paragraph(schema.text("hello")), paragraph(schema.text("world")));
  const expected = textAt(root, "world");
  assert.deepEqual(findMatches(root, "world", false), [expected]);
  assert.equal(expected.from, 8);
});

test("does not join text across paragraphs", () => {
  const root = doc(paragraph(schema.text("hello")), paragraph(schema.text("world")));
  assert.deepEqual(findMatches(root, "helloworld", false), []);
  assert.deepEqual(findMatches(root, "owor", false), []);
});

test("finds the same word in each paragraph", () => {
  const root = doc(paragraph(schema.text("cat")), paragraph(schema.text("cat")));
  const matches = findMatches(root, "cat", true);
  assert.deepEqual(matches, [
    { from: 1, to: 4 },
    { from: 6, to: 9 },
  ]);
});

test("matches across marks inside one paragraph", () => {
  const root = doc(
    paragraph(schema.text("hello "), schema.text("world", [schema.mark("bold")])),
  );
  assert.deepEqual(findMatches(root, "hello world", false), [{ from: 1, to: 12 }]);
  assert.deepEqual(findMatches(root, "world", false), [{ from: 7, to: 12 }]);
});

test("starts a match after an inline break instead of on the break", () => {
  const root = doc(
    paragraph(schema.text("hello"), schema.node("hard_break"), schema.text("world")),
  );
  assert.deepEqual(findMatches(root, "world", false), [textAt(root, "world")]);
  assert.equal(textAt(root, "world").from, 7);
});

test("respects case and empty queries", () => {
  const root = doc(paragraph(schema.text("Hello")), paragraph(schema.text("World")));
  assert.deepEqual(findMatches(root, "", false), []);
  assert.deepEqual(findMatches(root, "world", true), []);
  assert.deepEqual(findMatches(root, "world", false), [textAt(root, "World")]);
});

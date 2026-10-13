import assert from "node:assert/strict";
import test from "node:test";
import { handleCloseRequest, type CloseRequest } from "../src/closeGuard.ts";

function recorder(): CloseRequest & { prevented: boolean } {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test("a clean document closes without asking or preventing", async () => {
  const event = recorder();
  let asked = false;
  const outcome = await handleCloseRequest(event, false, false, async () => {
    asked = true;
    return false;
  });
  assert.equal(outcome, "close");
  assert.equal(event.prevented, false);
  assert.equal(asked, false);
});

test("discarding a dirty document closes", async () => {
  const event = recorder();
  const outcome = await handleCloseRequest(event, true, false, async () => true);
  assert.equal(outcome, "close");
  assert.equal(event.prevented, false);
});

test("cancelling the discard prompt keeps the window open", async () => {
  const event = recorder();
  const outcome = await handleCloseRequest(event, true, false, async () => false);
  assert.equal(outcome, "stay");
  assert.equal(event.prevented, true);
});

test("a failed ask keeps unsaved edits", async () => {
  const event = recorder();
  const outcome = await handleCloseRequest(event, true, false, async () => {
    throw new Error("dialog unavailable");
  });
  assert.equal(outcome, "stay");
  assert.equal(event.prevented, true);
});

test("a second close while the ask is open does not skip it", async () => {
  const event = recorder();
  let asked = false;
  const outcome = await handleCloseRequest(event, true, true, async () => {
    asked = true;
    return true;
  });
  assert.equal(outcome, "stay");
  assert.equal(event.prevented, true);
  assert.equal(asked, false);
});

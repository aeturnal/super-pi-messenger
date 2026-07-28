import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration } from "../src/duration.mjs";

test("parses valid durations", () => {
  assert.equal(parseDuration("250ms"), 250);
  assert.equal(parseDuration(" 5 m "), 300_000);
  assert.equal(parseDuration("1.5h"), 5_400_000);
});

test("rejects invalid durations", () => {
  for (const value of ["", "-1s", "1h 2m", "7d", 5]) {
    assert.throws(() => parseDuration(value), TypeError);
  }
});

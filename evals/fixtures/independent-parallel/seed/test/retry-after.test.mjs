import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfter } from "../src/retry-after.mjs";

const now = Date.parse("2026-07-27T12:00:00Z");

test("parses Retry-After delays and HTTP dates", () => {
  assert.equal(parseRetryAfter("120", now), 120_000);
  assert.equal(parseRetryAfter("Mon, 27 Jul 2026 12:01:30 GMT", now), 90_000);
  assert.equal(parseRetryAfter("Mon, 27 Jul 2026 11:00:00 GMT", now), 0);
});

test("handles invalid Retry-After values", () => {
  assert.equal(parseRetryAfter("invalid", now), null);
  assert.equal(parseRetryAfter("", now), null);
  assert.throws(() => parseRetryAfter("1", NaN), TypeError);
});

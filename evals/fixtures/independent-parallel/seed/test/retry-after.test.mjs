import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfter } from "../src/retry-after.mjs";

const now = Date.parse("2026-07-27T12:00:00Z");

test("parses Retry-After delays and strict IMF-fixdate values", () => {
  assert.equal(parseRetryAfter("120", now), 120_000);
  assert.equal(parseRetryAfter("Mon, 27 Jul 2026 12:01:30 GMT", now), 90_000);
  assert.equal(parseRetryAfter("Mon, 27 Jul 2026 11:00:00 GMT", now), 0);
});

test("rejects non-IMF-fixdate and malformed Retry-After values", () => {
  for (const value of [
    "invalid",
    "",
    "2026-07-27T12:01:30Z",
    "Monday, 27-Jul-26 12:01:30 GMT",
    "Mon Jul 27 12:01:30 2026",
    "7/27/2026",
    "-1",
    "1.5",
    "120 seconds",
    "Mon, 27 Jul 2026 12:01:30 GMT trailing",
  ]) assert.equal(parseRetryAfter(value, now), null);
  assert.throws(() => parseRetryAfter("1", NaN), TypeError);
});

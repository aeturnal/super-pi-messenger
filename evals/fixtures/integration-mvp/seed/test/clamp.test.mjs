import assert from "node:assert/strict";
import test from "node:test";

import { clamp } from "../src/clamp.mjs";

test("returns min for a value below the range", () => {
  assert.equal(clamp(-1, 0, 10), 0);
});

test("returns the value for a value inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
});

test("returns max for a value above the range", () => {
  assert.equal(clamp(11, 0, 10), 10);
});

test("throws RangeError when min is greater than max", () => {
  assert.throws(() => clamp(5, 10, 0), RangeError);
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes } from "../src/format-bytes.mjs";

test("formats binary byte counts", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1 KiB");
  assert.equal(formatBytes(1536), "1.5 KiB");
  assert.equal(formatBytes(1024 ** 3), "1 GiB");
});

test("rejects invalid byte counts", () => {
  for (const value of [-1, 1.5, Infinity, "1024"]) {
    assert.throws(() => formatBytes(value), TypeError);
  }
});

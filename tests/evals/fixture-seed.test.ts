import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const seed = resolve(root, "evals/fixtures/independent-parallel/seed");

describe("independent-parallel seed", () => {
  it("contains three disjoint task-owned stubs", () => {
    const prd = readFileSync(resolve(seed, "PRD.md"), "utf8");
    for (const path of ["src/duration.mjs", "src/format-bytes.mjs", "src/retry-after.mjs"]) {
      expect(prd).toContain(path);
      expect(readFileSync(resolve(seed, path), "utf8")).toContain("NOT_IMPLEMENTED");
    }
  });

  it("assigns exactly one source file and no test files to each task", () => {
    const prd = readFileSync(resolve(seed, "PRD.md"), "utf8");
    const tasks = prd.split(/^## Task \d+ — .*$/m).slice(1);
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task).toMatch(/Own only `src\/[\w-]+\.mjs`\./);
      expect(task).toContain("No test files are owned by this task.");
    }
    expect(JSON.parse(readFileSync(resolve(seed, "package.json"), "utf8"))).toEqual({
      name: "pi-super-messenger-independent-parallel-eval",
      private: true,
      type: "module",
      scripts: { test: "node --test test/*.test.mjs" },
    });
  });

  it("requires strict IMF-fixdate Retry-After acceptance cases", () => {
    const retryAfterTests = readFileSync(resolve(seed, "test/retry-after.test.mjs"), "utf8");
    expect(retryAfterTests).toContain('"Mon, 27 Jul 2026 12:01:30 GMT"');
    for (const invalid of [
      "2026-07-27T12:01:30Z",
      "Monday, 27-Jul-26 12:01:30 GMT",
      "Mon Jul 27 12:01:30 2026",
      "7/27/2026",
      '"-1"',
      '"1.5"',
      '"120 seconds"',
    ]) expect(retryAfterTests).toContain(invalid);
  });

  it("is intentionally red before workers implement it", () => {
    const result = spawnSync("node", ["--test", ...[
      "test/duration.test.mjs", "test/format-bytes.test.mjs", "test/retry-after.test.mjs",
    ]], { cwd: seed, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("NOT_IMPLEMENTED");
  });
});

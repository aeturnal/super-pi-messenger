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

  it("is intentionally red before workers implement it", () => {
    const result = spawnSync("node", ["--test", ...[
      "test/duration.test.mjs", "test/format-bytes.test.mjs", "test/retry-after.test.mjs",
    ]], { cwd: seed, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("NOT_IMPLEMENTED");
  });
});

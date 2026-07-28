import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Phase 0 eval definitions", () => {
  it("fixes all three evals before related fixtures are built", () => {
    const independent = read("evals/definitions/independent-parallel.md");
    const shared = read("evals/definitions/shared-interface.md");
    const repair = read("evals/definitions/review-repair.md");

    expect(independent).toContain("parseDuration(input)");
    expect(independent).toContain("formatBytes(bytes)");
    expect(independent).toContain("parseRetryAfter(value, nowMs)");
    expect(independent).toContain("Worker concurrency: `3`");
    expect(shared).toContain("CSV codec");
    expect(shared).toContain("JSON-lines codec");
    expect(shared).toContain("separate integration review");
    expect(repair).toContain("mergeSettings(defaults, overrides)");
    expect(repair).toContain("NEEDS_WORK");
    expect(repair).toContain("one scoped repair");
  });

  it("pins a non-secret stock comparison profile", () => {
    const profile = JSON.parse(read("evals/profiles/stock-baseline.json"));
    expect(profile).toEqual({
      package: "npm:pi-messenger@0.14.1",
      models: {
        planner: "openai-codex/gpt-5.6-sol",
        worker: "openai-codex/gpt-5.6-terra",
        reviewer: "openai-codex/gpt-5.6-sol",
        analyst: "openai-codex/gpt-5.6-luna",
      },
      concurrency: { workers: 3, max: 3 },
      planning: { maxPasses: 1 },
      review: { enabled: true, maxIterations: 1 },
      work: { maxAttemptsPerTask: 2 },
      coordination: "chatty",
      artifacts: { enabled: false },
    });
    expect(JSON.stringify(profile)).not.toMatch(/token|secret|api.?key/i);
  });

  it("defines durable results without committing raw runs", () => {
    const template = read("evals/results/TEMPLATE.md");
    const initial = read("evals/results/stock-pi-messenger-0.14.1-independent-parallel.md");
    const ignore = read("evals/runs/.gitignore");
    for (const heading of [
      "Run identity", "Functional outcome", "Orchestration observations",
      "Review outcome", "Reliability", "Usage metadata", "Evidence", "Comparability",
    ]) expect(template).toContain(`## ${heading}`);
    expect(initial).toContain("**Status:** `NOT RUN`");
    expect(ignore).toBe("*\n!.gitignore\n");
  });

  it("documents the exact supervised CLI lifecycle and model-use boundary", () => {
    const readme = read("evals/README.md");
    for (const command of [
      "node evals/scripts/reset-independent-parallel.mjs [destination-under-evals/runs/independent-parallel]",
      "node evals/scripts/prepare-stock-runtime.mjs [--source-agent-dir PATH] [--runtime-root PATH]",
      "node evals/scripts/verify-independent-parallel.mjs [worktree]",
      "node evals/scripts/cleanup-stock-runtime.mjs --runtime PATH [--evidence PATH]",
    ]) expect(readme).toContain(command);
    expect(readme).toContain("Preparation does not launch a model");
    expect(readme).toContain("printed Pi command begins provider usage");
    for (const step of ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.", "10."])
      expect(readme).toContain(step);
  });

  it("documents fetch-only selective upstream intake", () => {
    const upstream = read("docs/upstream-maintenance.md");
    expect(upstream).toContain("git fetch upstream --prune");
    expect(upstream).toContain("upstream push URL must remain `DISABLED`");
    expect(upstream).toContain("never merge automatically");
    expect(upstream).toContain("preserve authorship and attribution");
    expect(upstream).toContain("inherited unit tests and relevant eval acceptance checks");
  });
});

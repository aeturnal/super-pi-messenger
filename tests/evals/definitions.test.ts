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

  it("fixes definition ownership, lifecycle, and observation contracts", () => {
    const independent = read("evals/definitions/independent-parallel.md");
    const shared = read("evals/definitions/shared-interface.md");
    const repair = read("evals/definitions/review-repair.md");
    const headings = [
      "Purpose", "Fixed task", "Fixture boundary", "Procedure",
      "Deterministic acceptance", "Supervised observations", "Product target versus stock baseline",
    ];
    for (const definition of [independent, shared, repair])
      for (const heading of headings) expect(definition).toContain(`## ${heading}`);

    expect(independent).toContain("Each task owns only its listed source path");
    expect(independent).toContain("acceptance files are immutable inputs");
    expect(independent).toContain("Nested orchestration is prohibited");
    expect(shared).toContain("Each task owns only its codec and task-specific tests");
    expect(shared).toContain("shared canonical record contract is immutable");
    expect(repair).toContain("scoped repair owns only the relevant implementation and regression test");
    expect(repair).toContain("Nested orchestration is prohibited");
    expect(independent).toContain("nested orchestration (agents, controllers, worktrees, or orchestration)");
    expect(independent).toContain("retries, review cycles, human interventions");
    expect(independent).toContain("provider usage metadata");
    expect(shared).toContain("fixture is deferred to Phase 2");
    expect(shared).toContain("Nested orchestration, retries, interventions, review scope, and provider metadata");
    expect(repair).toContain("fixture is deferred to Phase 3");
    expect(repair).toContain("NEEDS_WORK is eligible only when the core design remains sound");
    expect(repair).toContain("architectural uncertainty requires `MAJOR_RETHINK`");
    expect(repair).toContain("one failed scoped repair escalates rather than repeats");
    expect(repair).toContain("add mutation regression coverage");
    expect(repair).toContain("re-review the repair-owned changes and perform a concise design sanity check");
    expect(repair).toContain("nested orchestration");
  });

  it.each([
    ["independent-parallel", "evals/definitions/independent-parallel.md"],
    ["shared-interface", "evals/definitions/shared-interface.md"],
    ["review-repair", "evals/definitions/review-repair.md"],
  ])("requires %s to prohibit nested orchestration and record complete supervised observations", (_name, path) => {
    const definition = read(path);

    expect(definition).toContain("Nested orchestration is prohibited");
    for (const observation of [
      /sessions/i,
      /retries/i,
      /review cycles/i,
      /human interventions/i,
      /wall-clock duration/i,
      /provider usage metadata/i,
    ]) expect(definition).toMatch(observation);
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
    for (const document of [template, initial]) {
      expect(document).toContain("- [ ]");
      expect(document).toContain("| Evidence | Value |");
      for (const field of [
        "Run ID", "Date", "Operator", "Fixture version", "Seed commit", "Final commit",
        "Stock package", "Profile", "Functional outcome", "Test-integrity outcome",
        "Task count", "Worker count", "Reviewer count", "Retry count", "Review-cycle count",
        "Worker-overlap", "Reservation conflicts", "Nested orchestration", "Human interventions",
        "Wall-clock duration", "Important findings", "Escaped defects", "provider usage metadata",
        "sanitized excerpt", "Deviations affecting comparison validity",
      ]) expect(document).toContain(field);
    }
    expect(template).toContain("sanitized excerpt");
    expect(initial).toContain("baseline only after implementation-plan Task 8 and human run completion");
    expect(ignore).toBe("*\n!.gitignore\n");
  });

  it("documents the exact supervised CLI lifecycle and model-use boundary", () => {
    const readme = read("evals/README.md");
    const design = read("docs/superpowers/specs/2026-07-27-phase-0-eval-foundation-design.md");
    const plan = read("docs/superpowers/plans/2026-07-27-phase-0-eval-foundation.md");
    for (const command of [
      "node evals/scripts/reset-independent-parallel.mjs [destination-under-evals/runs/independent-parallel]",
      "node evals/scripts/prepare-stock-runtime.mjs [--source-agent-dir PATH]",
      "node evals/scripts/verify-independent-parallel.mjs [worktree]",
      "node evals/scripts/cleanup-stock-runtime.mjs --runtime PATH",
    ]) expect(readme).toContain(command);
    expect(readme).toContain("Preparation does not launch a model");
    expect(readme).toContain("printed Pi command begins provider usage");
    expect(readme).toContain("Raw runtime evidence is inspectable only before cleanup");
    expect(readme).toContain("Cleanup never retains or copies raw runtime evidence");
    expect(readme).toContain("Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`");
    expect(readme).not.toContain("Retain raw sessions or terminal captures");
    for (const document of [design, plan]) {
      expect(document).toContain("Raw runtime evidence is inspectable only before cleanup");
      expect(document).toContain("Cleanup never retains or copies raw runtime evidence");
      expect(document).toContain("deliberately reviewed and sanitized excerpt under ignored `evals/runs/`");
    }
    for (const step of ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.", "10."])
      expect(readme).toContain(step);
  });

  it("records the post-security-review runtime-root trust boundary", () => {
    const readme = read("evals/README.md");
    const plan = read("docs/superpowers/plans/2026-07-27-phase-0-eval-foundation.md");

    expect(readme).not.toContain("--runtime-root");
    expect(plan).not.toContain("--runtime-root");
    for (const document of [readme, plan]) {
      expect(document).toContain("`runtimeRoot` injection exists only in the exported test API");
      expect(document).toContain("UID-scoped OS temporary root");
      expect(document).toContain("supersedes the original example after security review");
    }
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

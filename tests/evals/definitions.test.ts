import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const definitions = [
  text("evals/definitions/independent-parallel.md"),
  text("evals/definitions/shared-interface.md"),
  text("evals/definitions/review-repair.md"),
];

const profile = JSON.parse(text("evals/profiles/stock-baseline.json"));
const template = text("evals/results/TEMPLATE.md");
const initialResult = text(
  "evals/results/stock-pi-messenger-0.14.1-independent-parallel.md",
);
const runIgnore = text("evals/runs/.gitignore");
const readme = text("evals/README.md");
const upstreamPolicy = text("docs/upstream-maintenance.md");

describe("Phase 0 eval documentation contracts", () => {
  it("fixes all three eval lifecycles, acceptance, review scope, and observations", () => {
    expect(definitions).toHaveLength(3);
    expect(definitions[0]).toContain("parseDuration(input)");
    expect(definitions[0]).toContain("formatBytes(bytes)");
    expect(definitions[0]).toContain("parseRetryAfter(value, nowMs)");
    expect(definitions[0]).toContain("three");
    expect(definitions[1]).toContain("canonical record");
    expect(definitions[1]).toContain("integration review");
    expect(definitions[2]).toContain("NEEDS_WORK");
    expect(definitions[2]).toContain("one scoped repair");
    for (const definition of definitions) {
      expect(definition).toContain("Acceptance");
      expect(definition).toContain("review");
      expect(definition).toContain("nested orchestration");
      expect(definition).toContain("retries");
      expect(definition).toContain("interventions");
      expect(definition).toContain("provider");
    }
  });

  it("pins the non-secret stock profile and its execution controls", () => {
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
    expect(JSON.stringify(profile).toLowerCase()).not.toMatch(
      /auth|token|secret|password|api[_-]?key/,
    );
  });

  it("documents supervised lifecycle, durable evidence, and ignored raw runs", () => {
    for (const field of [
      "Run ID",
      "seed commit",
      "profile",
      "Functional",
      "test-integrity",
      "Worker-overlap",
      "reservation",
      "nested orchestration",
      "interventions",
      "provider usage",
      "deviation",
    ]) {
      expect(template.toLowerCase()).toContain(field.toLowerCase());
    }
    expect(initialResult).toContain("NOT RUN");
    expect(initialResult).toContain("not observable");
    expect(runIgnore).toContain("*");
    expect(runIgnore).toContain("!.gitignore");
    for (const term of [
      "never launch", "human", "auth.json", "models-store.json", "cleanup",
      "NOT RUN", "not observable", "node evals/scripts",
    ]) {
      expect(readme).toContain(term);
    }
  });

  it("requires fetch-only, selective, attributed, and tested upstream intake", () => {
    for (const term of [
      "fetch", "prune", "disabled", "never tracks", "never merged automatically",
      "smallest coherent", "authorship", "attribution", "PRD", "tests",
      "eval acceptance", "review process",
    ]) {
      expect(upstreamPolicy).toContain(term);
    }
  });
});

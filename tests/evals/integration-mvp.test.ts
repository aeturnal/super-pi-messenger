import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const fixturePaths = [
  "evals/fixtures/integration-mvp/seed/PRD.md",
  "evals/fixtures/integration-mvp/seed/.pi/skills/project-style/SKILL.md",
];

const stockSuperpowersExcerpts = [
  "Write the test first. Watch it fail. Write minimal code to pass.",
  "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST",
  "Core principle: Evidence before claims, always.",
  "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE",
];

describe("Superpowers integration MVP acceptance contract", () => {
  it("fixes the supervised worker and reviewer evidence", () => {
    const definition = read("evals/definitions/integration-mvp.md");

    for (const anchor of [
      "one preplanned task: `clamp(value, min, max)`",
      "stock `test-driven-development`",
      "stock `verification-before-completion`",
      "fixture `project-style`",
      "worker completion through `pi_messenger`",
      "reviewer reads stock `verification-before-completion`",
      "exactly one worktree",
      "nested `dispatch_agent`, Pi, or worktree calls are forbidden",
      "all tests passing",
      "task state is `done`",
    ]) expect(definition).toContain(anchor);
  });

  it("defines silent inactive acceptance separately", () => {
    const definition = read("evals/definitions/integration-mvp.md");

    expect(definition).toContain("## Silent inactive acceptance");
    expect(definition).toContain("separate run");
    expect(definition).toContain("silent mode");
    expect(definition).toContain("integration remains inactive");
  });

  it("keeps the fixture PRD limited to the clamp contract and process", () => {
    const prd = read(fixturePaths[0]);

    for (const anchor of [
      "named export `clamp(value, min, max)`",
      "below `min`",
      "inside the range",
      "above `max`",
      "`RangeError` when `min > max`",
      "tests first",
      "existing automatic review",
    ]) expect(prd).toContain(anchor);
  });

  it("provides the exact unrelated project skill", () => {
    const skill = read(fixturePaths[1]);

    expect(skill).toBe(`---\nname: project-style\ndescription: Preserve the fixture's public module style.\n---\n\nKeep \`clamp\` as a named export. Do not add a default export.\n`);
  });

  it("preseeds bounded Crew configuration and one incomplete task", () => {
    const config = JSON.parse(
      read("evals/fixtures/integration-mvp/seed/.pi/messenger/crew/config.json"),
    );
    const plan = JSON.parse(
      read("evals/fixtures/integration-mvp/seed/.pi/messenger/crew/plan.json"),
    );

    expect(config.review.enabled).toBe(true);
    expect(config.artifacts.enabled).toBe(true);
    expect(config.concurrency.workers).toBe(1);
    expect(config.concurrency.max).toBe(1);
    expect(plan.task_count).toBe(1);
    expect(plan.completed_count).toBe(0);
  });

  it("preseeds the single Crew task and complete task brief", () => {
    const task = JSON.parse(
      read("evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.json"),
    );
    const brief = read(
      "evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.md",
    );

    expect(task).toEqual({
      id: "task-1",
      title: "Implement clamp with test-first evidence",
      status: "todo",
      depends_on: [],
      skills: ["project-style"],
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
      attempt_count: 0,
    });
    expect(brief).toContain("Read the `project-style` skill");
    expect(brief).toContain("Observe the failing tests");
    expect(brief).toContain("Implement only `clamp`");
    expect(brief).toContain("Run fresh tests");
    expect(brief).toContain("Commit the implementation");
    expect(brief).toContain("Report completion through `pi_messenger`");
    expect(brief).toContain("Do not start nested agents");
    expect(brief).toContain("Do not create, switch to, or manage nested worktrees");
  });

  it("starts with genuinely failing clamp tests", () => {
    const seed = fileURLToPath(
      new URL("../../evals/fixtures/integration-mvp/seed", import.meta.url),
    );
    const result = spawnSync("npm", ["test"], {
      cwd: seed,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1_048_576,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("not implemented");
  });

  it("does not copy bounded stock Superpowers prose into fixture files", () => {
    for (const path of fixturePaths) {
      const fixture = read(path);
      for (const excerpt of stockSuperpowersExcerpts)
        expect(fixture, `${path} copied stock prose`).not.toContain(excerpt);
    }
  });
});

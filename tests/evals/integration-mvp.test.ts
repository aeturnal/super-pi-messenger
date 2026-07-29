import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resetIntegrationMvp } from "../../evals/scripts/reset-integration-mvp.mjs";

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

const resetRoots: string[] = [];
const resetMarker = {
  schemaVersion: 1,
  kind: "pi-super-messenger-eval-run",
  fixture: "integration-mvp",
};

function createResetRepository() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "integration-mvp-reset-"));
  const runRoot = join(repositoryRoot, "evals", "runs", "integration-mvp");
  mkdirSync(runRoot, { recursive: true });
  resetRoots.push(repositoryRoot);
  return { repositoryRoot, runRoot };
}

function invokeReset(repositoryRoot: string, destination: string) {
  return () =>
    resetIntegrationMvp({
      repositoryRoot,
      destination,
      now: new Date("2026-07-29T00:00:00.000Z"),
    });
}

afterEach(() => {
  for (const root of resetRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

describe("reset destination guards", () => {
  it.each([
    ["the run root itself", (repositoryRoot: string, runRoot: string) => runRoot],
    ["an outside path", (repositoryRoot: string) => join(repositoryRoot, "outside")],
    [
      "a sibling-prefix path",
      (repositoryRoot: string) =>
        join(repositoryRoot, "evals", "runs", "integration-mvp-sibling", "worktree"),
    ],
  ])("rejects %s without mutation", (_label, destinationFor) => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = destinationFor(repositoryRoot, runRoot);
    const sentinel = join(runRoot, "sentinel.txt");
    writeFileSync(sentinel, "preserve me\n");

    expect(invokeReset(repositoryRoot, destination)).toThrow(/descendant of the integration run root/);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve me\n");
    expect(existsSync(destination)).toBe(destination === runRoot);
  });

  it("rejects an existing non-directory destination without mutation", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    writeFileSync(destination, "preserve file\n");

    expect(invokeReset(repositoryRoot, destination)).toThrow(/existing destination must be a directory/i);
    expect(readFileSync(destination, "utf8")).toBe("preserve file\n");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "{not json\n"],
    ["wrong", JSON.stringify({ ...resetMarker, fixture: "other-fixture" })],
  ])("rejects an existing destination with a %s marker without mutation", (_label, marker) => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const markerPath = join(destination, ".git", "pi-super-messenger-eval-marker.json");
    const sentinel = join(destination, "sentinel.txt");
    mkdirSync(join(destination, ".git"), { recursive: true });
    writeFileSync(sentinel, "preserve directory\n");
    if (marker !== undefined) writeFileSync(markerPath, marker);

    expect(invokeReset(repositoryRoot, destination)).toThrow(/valid integration MVP marker/);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve directory\n");
    if (marker === undefined) expect(existsSync(markerPath)).toBe(false);
    else expect(readFileSync(markerPath, "utf8")).toBe(marker);
  });

  it("rejects a symlink marker without mutating the link or target", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const gitDirectory = join(destination, ".git");
    const markerPath = join(gitDirectory, "pi-super-messenger-eval-marker.json");
    const markerTarget = join(repositoryRoot, "marker-target.json");
    mkdirSync(gitDirectory, { recursive: true });
    writeFileSync(markerTarget, JSON.stringify(resetMarker));
    symlinkSync(markerTarget, markerPath);

    expect(invokeReset(repositoryRoot, destination)).toThrow(/valid integration MVP marker/);
    expect(lstatSync(markerPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(markerPath)).toBe(markerTarget);
    expect(readFileSync(markerTarget, "utf8")).toBe(JSON.stringify(resetMarker));
  });

  it("rejects a symlinked .git directory without mutating either run", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const otherRun = join(runRoot, "other-run");
    const otherGitDirectory = join(otherRun, ".git");
    const linkedGitDirectory = join(destination, ".git");
    const markerPath = join(otherGitDirectory, "pi-super-messenger-eval-marker.json");
    const markerText = `${JSON.stringify(resetMarker)}\n`;
    const destinationSentinel = join(destination, "sentinel.txt");
    const otherRunSentinel = join(otherRun, "sentinel.txt");
    mkdirSync(destination, { recursive: true });
    mkdirSync(otherGitDirectory, { recursive: true });
    writeFileSync(markerPath, markerText);
    writeFileSync(destinationSentinel, "preserve destination\n");
    writeFileSync(otherRunSentinel, "preserve other run\n");
    symlinkSync(otherGitDirectory, linkedGitDirectory);

    expect(invokeReset(repositoryRoot, destination)).toThrow(/valid integration MVP marker/);
    expect(lstatSync(linkedGitDirectory).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkedGitDirectory)).toBe(otherGitDirectory);
    expect(readFileSync(destinationSentinel, "utf8")).toBe("preserve destination\n");
    expect(readFileSync(otherRunSentinel, "utf8")).toBe("preserve other run\n");
    expect(readFileSync(markerPath, "utf8")).toBe(markerText);
  });

  it("stops at the creation seam for a safe missing destination", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");

    expect(invokeReset(repositoryRoot, destination)).toThrow(/creation is not implemented in Task 16/);
    expect(existsSync(destination)).toBe(false);
  });

  it("stops at the creation seam without mutating a correctly marked destination", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const markerPath = join(destination, ".git", "pi-super-messenger-eval-marker.json");
    const markerText = `${JSON.stringify(resetMarker, null, 2)}\n`;
    const sentinel = join(destination, "sentinel.txt");
    mkdirSync(join(destination, ".git"), { recursive: true });
    writeFileSync(markerPath, markerText);
    writeFileSync(sentinel, "preserve marked directory\n");

    expect(invokeReset(repositoryRoot, destination)).toThrow(/creation is not implemented in Task 16/);
    expect(readFileSync(markerPath, "utf8")).toBe(markerText);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve marked directory\n");
  });
});

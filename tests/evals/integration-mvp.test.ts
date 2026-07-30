import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resetIntegrationMvp } from "../../evals/scripts/reset-integration-mvp.mjs";
import { verifyIntegrationMvp } from "../../evals/scripts/verify-integration-mvp.mjs";

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
  const seed = fileURLToPath(
    new URL("../../evals/fixtures/integration-mvp/seed", import.meta.url),
  );
  mkdirSync(runRoot, { recursive: true });
  cpSync(seed, join(repositoryRoot, "evals", "fixtures", "integration-mvp", "seed"), {
    recursive: true,
  });
  resetRoots.push(repositoryRoot);
  return { repositoryRoot, runRoot };
}

function invokeReset(repositoryRoot: string, destination: string) {
  return () =>
    resetIntegrationMvp({
      repositoryRoot,
      destination,
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
}

function createCompletedIntegrationRun() {
  const { repositoryRoot, runRoot } = createResetRepository();
  const worktree = join(runRoot, "worktree");
  resetIntegrationMvp({
    repositoryRoot,
    destination: worktree,
    now: () => new Date("2026-07-29T00:00:00.000Z"),
  });
  writeFileSync(
    join(worktree, "src", "clamp.mjs"),
    `export function clamp(value, min, max) {\n  if (min > max) throw new RangeError("min must not exceed max");\n  return Math.min(max, Math.max(min, value));\n}\n`,
  );
  const taskPath = join(worktree, ".pi", "messenger", "crew", "tasks", "task-1.json");
  const task = JSON.parse(readFileSync(taskPath, "utf8"));
  writeFileSync(taskPath, `${JSON.stringify({ ...task, status: "done" }, null, 2)}\n`);
  return { repositoryRoot, worktree };
}

function withGitWorktreeOutput(output: string, verify: () => void) {
  const shimRoot = mkdtempSync(join(tmpdir(), "integration-mvp-git-shim-"));
  const git = join(shimRoot, "git");
  writeFileSync(
    git,
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(output)});\n`,
  );
  chmodSync(git, 0o755);
  resetRoots.push(shimRoot);
  const originalPath = process.env.PATH;
  process.env.PATH = `${shimRoot}${delimiter}${originalPath ?? ""}`;
  try {
    verify();
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
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

describe("integration run reset", () => {
  it("creates integration run from the fixed seed and commits it on main", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");

    const result = resetIntegrationMvp({
      repositoryRoot,
      destination,
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: destination, encoding: "utf8" }).stdout.trim();

    expect(readFileSync(join(destination, "PRD.md"), "utf8")).toBe(
      read("evals/fixtures/integration-mvp/seed/PRD.md"),
    );
    expect(git("branch", "--show-current")).toBe("main");
    expect(result).toMatchObject({ worktree: destination, seedCommit: git("rev-parse", "HEAD") });
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("creates the same seed commit in clean and hostile inherited Git environments", () => {
    const clean = createResetRepository();
    const hostile = createResetRepository();
    const hostileRoot = mkdtempSync(join(tmpdir(), "integration-mvp-hostile-git-"));
    const hooks = join(hostileRoot, "hooks");
    const hookCalls = join(hostileRoot, "hook-calls.txt");
    const signerCalls = join(hostileRoot, "signer-calls.txt");
    const globalConfig = join(hostileRoot, "global.gitconfig");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\necho hook >> "${hookCalls}"\nexit 71\n`);
    writeFileSync(join(hostileRoot, "signer"), `#!/bin/sh\necho signer >> "${signerCalls}"\nexit 72\n`);
    chmodSync(join(hooks, "pre-commit"), 0o755);
    chmodSync(join(hostileRoot, "signer"), 0o755);
    writeFileSync(
      globalConfig,
      `[commit]\n\tgpgSign = true\n[core]\n\thooksPath = ${hooks}\n[gpg]\n\tprogram = ${join(hostileRoot, "signer")}\n`,
    );
    resetRoots.push(hostileRoot);

    const originalEnvironment = { ...process.env };
    let nowCalls = 0;
    const now = () => {
      nowCalls += 1;
      return new Date("2026-07-29T00:00:00.000Z");
    };

    try {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("GIT_")) delete process.env[key];
      }
      const cleanResult = resetIntegrationMvp({
        repositoryRoot: clean.repositoryRoot,
        destination: join(clean.runRoot, "worktree"),
        now,
      });
      const dates = spawnSync("git", ["show", "-s", "--format=%aI%n%cI", "HEAD"], {
        cwd: cleanResult.worktree,
        encoding: "utf8",
      }).stdout.trim().split("\n");

      Object.assign(process.env, {
        GIT_AUTHOR_NAME: "Hostile Author",
        GIT_COMMITTER_EMAIL: "hostile@example.invalid",
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_DIR: join(hostileRoot, "redirected.git"),
        GIT_INDEX_FILE: join(hostileRoot, "redirected.index"),
        GIT_WORK_TREE: hostileRoot,
      });
      const hostileResult = resetIntegrationMvp({
        repositoryRoot: hostile.repositoryRoot,
        destination: join(hostile.runRoot, "worktree"),
        now,
      });
      expect(hostileResult.seedCommit).toBe(cleanResult.seedCommit);
      expect(dates).toEqual([
        "2026-07-29T00:00:00Z",
        "2026-07-29T00:00:00Z",
      ]);
      expect(nowCalls).toBe(2);
      expect(existsSync(hookCalls)).toBe(false);
      expect(existsSync(signerCalls)).toBe(false);
      expect(existsSync(join(hostileRoot, "redirected.git"))).toBe(false);
      expect(existsSync(join(hostileRoot, "redirected.index"))).toBe(false);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, originalEnvironment);
    }
  });

  it("writes the exact marker and manifest after the seed commit", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const result = resetIntegrationMvp({
      repositoryRoot,
      destination,
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    });
    const markerPath = join(destination, ".git", "pi-super-messenger-eval-marker.json");

    expect(JSON.parse(readFileSync(markerPath, "utf8"))).toEqual(resetMarker);
    expect(result.manifestPath).toBe(
      join(destination, ".git", "pi-super-messenger-eval-run.json"),
    );
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toEqual({
      schemaVersion: 1,
      fixture: "integration-mvp",
      seedCommit: result.seedCommit,
      testHashes: {
        "test/clamp.test.mjs":
          "0c7c497d969092efb23508bfd0fe8b6e2b84346f1c758be02ba1ee66112d4b05",
      },
      createdAt: "2026-07-29T00:00:00.000Z",
      result: { status: "not-run", verifier: null, supervised: null },
    });
  });

  it("provides a bounded zero-or-one-argument CLI that directly invokes Git only", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const cliRoot = join(runRoot, "cli-test");
    const destination = join(cliRoot, "explicit-worktree");
    const defaultDestination = join(runRoot, "worktree");
    const scripts = join(repositoryRoot, "evals", "scripts");
    const bin = join(cliRoot, "bin");
    const commandLog = join(cliRoot, "commands.jsonl");
    const script = join(scripts, "reset-integration-mvp.mjs");
    const realGit = process.env.PATH?.split(delimiter)
      .map((entry) => join(entry, "git"))
      .find(existsSync);
    expect(realGit).toBeDefined();
    mkdirSync(bin, { recursive: true });
    mkdirSync(scripts, { recursive: true });
    cpSync(fileURLToPath(new URL("../../evals/scripts/reset-integration-mvp.mjs", import.meta.url)), script);
    cpSync(fileURLToPath(new URL("../../evals/scripts/lib.mjs", import.meta.url)), join(scripts, "lib.mjs"));

    for (const command of [
      "git",
      "pi",
      "claude",
      "codex",
      "ollama",
      "curl",
      "wget",
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "bun",
    ]) {
      const executable = join(bin, command);
      writeFileSync(
        executable,
        `#!${process.execPath}\n` +
          `const fs = require("node:fs");\n` +
          `const { spawnSync } = require("node:child_process");\n` +
          `fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify({ command: ${JSON.stringify(command)}, args: process.argv.slice(2) }) + "\\n");\n` +
          (command === "git"
            ? `const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: "inherit", env: process.env }); process.exit(result.status ?? 1);\n`
            : `process.exit(97);\n`),
      );
      chmodSync(executable, 0o755);
    }

    const environment = { ...process.env, PATH: bin };
    const defaultCreated = spawnSync(process.execPath, [script], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
    });
    const explicitlyCreated = spawnSync(process.execPath, [script, destination], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
    });
    const rejected = spawnSync(
      process.execPath,
      [script, join(cliRoot, "first"), join(cliRoot, "second")],
      { cwd: repositoryRoot, env: environment, encoding: "utf8" },
    );
    const commands = readFileSync(commandLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { command: string; args: string[] });

    expect(defaultCreated.status).toBe(0);
    expect(JSON.parse(defaultCreated.stdout)).toMatchObject({ worktree: defaultDestination });
    expect(explicitlyCreated.status).toBe(0);
    expect(JSON.parse(explicitlyCreated.stdout)).toMatchObject({
      worktree: destination,
      manifestPath: join(destination, ".git", "pi-super-messenger-eval-run.json"),
    });
    expect(commands.length).toBeGreaterThan(0);
    expect([...new Set(commands.map(({ command }) => command))]).toEqual(["git"]);
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toContain("Usage: reset-integration-mvp.mjs [destination]");
    expect(existsSync(join(cliRoot, "first"))).toBe(false);
    expect(existsSync(join(cliRoot, "second"))).toBe(false);
  });
});

describe("integration MVP verifier", () => {
  it("accepts the exact integration marker and matching immutable test", () => {
    const run = createCompletedIntegrationRun();

    expect(verifyIntegrationMvp(run)).toEqual({
      status: "passed",
      workerTrace: "",
      reviewerTrace: "",
    });
  });

  it("rejects a marker with the wrong fixture identity", () => {
    const run = createCompletedIntegrationRun();
    const markerPath = join(run.worktree, ".git", "pi-super-messenger-eval-marker.json");
    writeFileSync(markerPath, `${JSON.stringify({ ...resetMarker, fixture: "other" })}\n`);

    expect(() => verifyIntegrationMvp(run)).toThrow("Invalid integration MVP marker");
  });

  it("rejects a changed manifest-listed immutable test", () => {
    const run = createCompletedIntegrationRun();
    const testPath = join(run.worktree, "test", "clamp.test.mjs");
    writeFileSync(testPath, `${readFileSync(testPath, "utf8")}\n// changed\n`);

    expect(() => verifyIntegrationMvp(run)).toThrow(
      "Immutable test hash mismatch: test/clamp.test.mjs",
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", {}],
    ["non-object", []],
    ["malformed", { "test/clamp.test.mjs": "0".repeat(63) }],
    ["uppercase", { "test/clamp.test.mjs": "A".repeat(64) }],
  ])("rejects %s immutable hashes", (_case, testHashes) => {
    const run = createCompletedIntegrationRun();
    const manifestPath = join(run.worktree, ".git", "pi-super-messenger-eval-run.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, testHashes })}\n`);

    expect(() => verifyIntegrationMvp(run)).toThrow("Invalid immutable hashes/path");
  });

  it.each([
    { "../clamp.test.mjs": "0".repeat(64) },
    {
      "test/clamp.test.mjs":
        "0c7c497d969092efb23508bfd0fe8b6e2b84346f1c758be02ba1ee66112d4b05",
      "../clamp.test.mjs": "0".repeat(64),
    },
  ])("rejects escaping replacement or extra immutable hash keys", (testHashes) => {
    const run = createCompletedIntegrationRun();
    const manifestPath = join(run.worktree, ".git", "pi-super-messenger-eval-run.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, testHashes })}\n`);

    expect(() => verifyIntegrationMvp(run)).toThrow("Invalid immutable hashes/path");
  });

  it("rejects a missing manifest-listed immutable test", () => {
    const run = createCompletedIntegrationRun();
    rmSync(join(run.worktree, "test", "clamp.test.mjs"));

    expect(() => verifyIntegrationMvp(run)).toThrow(
      "Missing immutable test file: test/clamp.test.mjs",
    );
  });

  it("reports fixture tests that fail", () => {
    const run = createCompletedIntegrationRun();
    writeFileSync(
      join(run.worktree, "src", "clamp.mjs"),
      `export function clamp() { throw new Error("broken"); }\n`,
    );

    expect(() => verifyIntegrationMvp(run)).toThrow("Fixture tests failed");
  });

  it("requires the fixed task state to be done", () => {
    const run = createCompletedIntegrationRun();
    const taskPath = join(
      run.worktree,
      ".pi",
      "messenger",
      "crew",
      "tasks",
      "task-1.json",
    );
    const task = JSON.parse(readFileSync(taskPath, "utf8"));
    writeFileSync(taskPath, `${JSON.stringify({ ...task, status: "todo" }, null, 2)}\n`);

    expect(() => verifyIntegrationMvp(run)).toThrow("Task task-1 is not done: todo");
  });

  it("accepts exactly one worktree line", () => {
    const run = createCompletedIntegrationRun();

    withGitWorktreeOutput(
      `worktree ${run.worktree}\nHEAD abc123\nbranch refs/heads/main\nnote worktree ignored\n`,
      () => expect(verifyIntegrationMvp(run).status).toBe("passed"),
    );
  });

  it("rejects more than one worktree line", () => {
    const run = createCompletedIntegrationRun();

    withGitWorktreeOutput(
      `worktree ${run.worktree}\nHEAD abc123\n\nworktree /tmp/other\nHEAD def456\n`,
      () =>
        expect(() => verifyIntegrationMvp(run)).toThrow(
          "Expected exactly one Git worktree, found 2",
        ),
    );
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

  it("creates a safe missing destination", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");

    const result = resetIntegrationMvp({ repositoryRoot, destination });

    expect(result.worktree).toBe(destination);
    expect(existsSync(join(destination, ".git", "pi-super-messenger-eval-marker.json"))).toBe(true);
  });

  it("replaces a correctly marked destination", () => {
    const { repositoryRoot, runRoot } = createResetRepository();
    const destination = join(runRoot, "worktree");
    const markerPath = join(destination, ".git", "pi-super-messenger-eval-marker.json");
    const sentinel = join(destination, "sentinel.txt");
    mkdirSync(join(destination, ".git"), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify(resetMarker, null, 2)}\n`);
    writeFileSync(sentinel, "replace marked directory\n");

    const result = resetIntegrationMvp({ repositoryRoot, destination });

    expect(result.worktree).toBe(destination);
    expect(existsSync(sentinel)).toBe(false);
    expect(JSON.parse(readFileSync(markerPath, "utf8"))).toEqual(resetMarker);
  });
});

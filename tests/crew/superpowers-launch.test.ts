import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnAgents } from "../../crew/agents.js";
import {
  captureSuperpowersSkills,
  resetSuperpowersStateForTests,
} from "../../crew/superpowers.js";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.js";
import {
  createStockSuperpowersFixture,
  type StockSuperpowersFixture,
} from "../helpers/superpowers.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

type MockProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
};

type SpawnCapture = {
  args: string[];
  options: { env?: NodeJS.ProcessEnv };
  prompt?: string;
};

function comparableCapture(capture: SpawnCapture): SpawnCapture {
  const promptFlag = capture.args.indexOf("--append-system-prompt");
  const args = [...capture.args];
  if (promptFlag !== -1) args[promptFlag + 1] = "<prompt-path>";

  const env = capture.options.env === undefined ? undefined : { ...capture.options.env };
  if (env?.PI_AGENT_NAME) env.PI_AGENT_NAME = "<generated-agent-name>";

  return { args, options: { env }, prompt: capture.prompt };
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.exitCode = null;
  proc.kill = vi.fn(() => true);

  queueMicrotask(() => {
    proc.exitCode = 0;
    proc.emit("exit", 0);
    proc.emit("close", 0);
  });

  return proc;
}

function writeWorkerAgent(cwd: string): void {
  const agentPath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });
  fs.writeFileSync(agentPath, `---
name: crew-worker
description: Test worker
crewRole: worker
---
You are a test worker.
`);
}

function writeReviewerAgent(cwd: string): void {
  const agentPath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-reviewer.md");
  fs.mkdirSync(path.dirname(agentPath), { recursive: true });
  fs.writeFileSync(agentPath, `---
name: crew-reviewer
description: Test reviewer
crewRole: reviewer
---
You are a test reviewer.
`);
}

describe("Crew Superpowers launch boundary", () => {
  let dirs: TempCrewDirs;
  let fixture: StockSuperpowersFixture;
  let captures: SpawnCapture[];

  beforeEach(() => {
    resetSuperpowersStateForTests();
    dirs = createTempCrewDirs();
    fixture = createStockSuperpowersFixture();
    captureSuperpowersSkills(fixture.skills);
    writeWorkerAgent(dirs.cwd);
    captures = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command: string, args: string[], options: SpawnCapture["options"]) => {
      const promptFlag = args.indexOf("--append-system-prompt");
      captures.push({
        args: [...args],
        options,
        ...(promptFlag === -1 ? {} : { prompt: fs.readFileSync(args[promptFlag + 1]!, "utf8") }),
      });
      return createMockProcess();
    });
  });

  afterEach(() => {
    fixture.cleanup();
    resetSuperpowersStateForTests();
  });

  it("adds ordered active guidance to the worker prompt", async () => {
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement task",
      taskId: "task-1",
    }], dirs.cwd);

    const prompt = captures[0]?.prompt;
    expect(prompt).toBeDefined();
    expect(prompt!.indexOf("test-driven-development")).toBeGreaterThan(-1);
    expect(prompt!.indexOf("verification-before-completion")).toBeGreaterThan(
      prompt!.indexOf("test-driven-development"),
    );
  });

  it("preserves the exact project override before integration guidance", async () => {
    const agentPath = path.join(
      dirs.cwd,
      ".pi",
      "messenger",
      "crew",
      "agents",
      "crew-worker.md",
    );
    fs.writeFileSync(agentPath, `---
name: crew-worker
description: Project override worker
crewRole: worker
---
Project override.

Keep this spacing.
`);

    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement override task",
      taskId: "task-override",
    }], dirs.cwd);

    expect(captures[0]?.prompt).toMatch(/^Project override\.\n\nKeep this spacing\.\n\nPi-messenger Crew is the sole orchestrator and task authority\./);
  });

  it("gives an active reviewer verification guidance without worker TDD guidance", async () => {
    writeReviewerAgent(dirs.cwd);

    await spawnAgents([{
      agent: "crew-reviewer",
      task: "Review task",
      taskId: "review-1",
    }], dirs.cwd);

    const capture = captures[0]!;
    expect(capture.prompt).toContain("verification-before-completion");
    expect(capture.prompt).not.toContain("test-driven-development");
    expect(capture.args).toContain(fileURLToPath(
      new URL("../../crew/superpowers-guard.ts", import.meta.url),
    ));
    expect(capture.options.env).toMatchObject({
      PI_CREW_ROLE: "reviewer",
      PI_CREW_SUPERPOWERS_MVP: "1",
    });
  });

  it("keeps inactive worker launch equivalent to the reset native baseline", async () => {
    resetSuperpowersStateForTests();
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement inactive task",
      taskId: "task-inactive",
    }], dirs.cwd);
    const baseline = captures[0]!;

    captureSuperpowersSkills([]);
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement inactive task",
      taskId: "task-inactive",
    }], dirs.cwd);
    const inactive = captures[1]!;

    expect(comparableCapture(inactive)).toEqual(comparableCapture(baseline));
    expect(inactive.args).not.toContain(fileURLToPath(
      new URL("../../crew/superpowers-guard.ts", import.meta.url),
    ));
    expect(inactive.options.env).toMatchObject({
      PI_CREW_WORKER: "1",
      PI_AGENT_NAME: expect.any(String),
    });
    expect(inactive.options.env).not.toHaveProperty("PI_CREW_ROLE");
    expect(inactive.options.env).not.toHaveProperty("PI_CREW_SUPERPOWERS_MVP");
    expect(inactive.prompt).toBe("You are a test worker.");
    expect(inactive.prompt).not.toContain("Selected Superpowers skills:");
  });

  it("keeps recognizable fallback worker launch equivalent to the reset native baseline", async () => {
    resetSuperpowersStateForTests();
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement fallback task",
      taskId: "task-fallback",
    }], dirs.cwd);
    const baseline = captures[0]!;

    fixture.cleanup();
    fixture = createStockSuperpowersFixture({ version: "7.0.0" });
    expect(captureSuperpowersSkills(fixture.skills)).toMatchObject({
      status: "fallback",
      reason: "unsupported Superpowers major version",
    });
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement fallback task",
      taskId: "task-fallback",
    }], dirs.cwd);
    const fallback = captures[1]!;

    expect(comparableCapture(fallback)).toEqual(comparableCapture(baseline));
    expect(fallback.args).not.toContain(fileURLToPath(
      new URL("../../crew/superpowers-guard.ts", import.meta.url),
    ));
    expect(fallback.options.env).toMatchObject({
      PI_CREW_WORKER: "1",
      PI_AGENT_NAME: expect.any(String),
    });
    expect(fallback.options.env).not.toHaveProperty("PI_CREW_ROLE");
    expect(fallback.options.env).not.toHaveProperty("PI_CREW_SUPERPOWERS_MVP");
    expect(fallback.prompt).toBe("You are a test worker.");
    expect(fallback.prompt).not.toContain("Selected Superpowers skills:");
  });

  it("adds the guard and metadata for active child activation", async () => {
    await spawnAgents([{
      agent: "crew-worker",
      task: "Implement task",
      taskId: "task-1",
    }], dirs.cwd);

    const capture = captures[0]!;
    const extensionPaths = capture.args.flatMap((arg, index) =>
      arg === "--extension" ? [capture.args[index + 1]!] : []
    );
    expect(extensionPaths.slice(-2)).toEqual([
      path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      fileURLToPath(new URL("../../crew/superpowers-guard.ts", import.meta.url)),
    ]);
    expect(capture.options.env).toMatchObject({
      PI_CREW_ROLE: "worker",
      PI_CREW_SUPERPOWERS_MVP: "1",
    });
  });
});

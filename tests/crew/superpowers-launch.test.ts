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

describe("Crew Superpowers launch boundary", () => {
  let dirs: TempCrewDirs;
  let fixture: StockSuperpowersFixture;
  let captures: SpawnCapture[];

  beforeEach(() => {
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

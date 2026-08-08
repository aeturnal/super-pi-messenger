import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnAgents } from "../../crew/agents.ts";
import { executeCrewAction } from "../../crew/index.ts";
import * as store from "../../crew/store.ts";
import { resolveWorkspace } from "../../crew/workspace.ts";
import { createGitWorktreeFixture, type GitWorktreeFixture } from "../helpers/git-worktree.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

const spawnMock = vi.hoisted(() => vi.fn());
const workExecute = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: spawnMock,
}));

vi.mock("../../crew/handlers/work.ts", () => ({ execute: workExecute }));
vi.mock("../../crew/utils/child-process.ts", () => ({
  isCrewChildProcess: () => false,
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
  options: { cwd?: string; env: NodeJS.ProcessEnv };
  systemPrompt?: string;
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

function writeAgent(cwd: string, role: "planner" | "worker" | "reviewer" | "analyst"): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", `crew-${role}.md`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-${role}
description: Test ${role}
crewRole: ${role}
---
You are a test ${role}.
`);
}

function registeredState() {
  return {
    agentName: "AgentOne", registered: true, watcher: null, watcherRetries: 0,
    watcherRetryTimer: null, watcherDebounceTimer: null, reservations: [],
    chatHistory: new Map(), unreadCounts: new Map(), broadcastHistory: [], seenSenders: new Map(),
    model: undefined, cwd: process.cwd(), gitBranch: undefined, spec: undefined,
    scopeToFolder: false, isHuman: false, session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() }, statusMessage: undefined, customStatus: false,
    registryFlushTimer: null, sessionStartedAt: new Date().toISOString(),
  } as any;
}

function dirs(cwd: string) {
  const base = path.join(cwd, ".pi", "messenger");
  const result = { base, registry: path.join(base, "registry"), inbox: path.join(base, "inbox") };
  fs.mkdirSync(result.registry, { recursive: true });
  fs.mkdirSync(result.inbox, { recursive: true });
  return result;
}

describe("workspace-backed child launches", () => {
  let fx: GitWorktreeFixture;
  let captures: SpawnCapture[];

  beforeEach(() => {
    vi.stubEnv("PI_CREW_WORKSPACE_ROOT", undefined);
    fx = createGitWorktreeFixture();
    captures = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command: string, args: string[], options: SpawnCapture["options"]) => {
      const promptFlag = args.indexOf("--append-system-prompt");
      captures.push({
        args: [...args],
        options,
        ...(promptFlag === -1 ? {} : { systemPrompt: fs.readFileSync(args[promptFlag + 1]!, "utf8") }),
      });
      return createMockProcess();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fx.cleanup();
  });

  it.each(["planner", "worker", "reviewer", "analyst"] as const)(
    "launches a %s child in the stored workspace with identity guidance",
    async (role) => {
      writeAgent(fx.worktree, role);
      const identity = resolveWorkspace(fx.worktree, fx.worktree);
      store.createPlan(fx.worktree, "docs/plan.md", undefined, identity);

      await spawnAgents([{ agent: `crew-${role}`, task: "Run task", taskId: `${role}-1` }], fx.worktree);

      const capture = captures[0]!;
      expect(capture.options.cwd).toBe(identity.root);
      expect(capture.options.env.PI_CREW_WORKSPACE_ROOT).toBe(identity.root);
      expect(capture.systemPrompt).toContain(identity.root);
      expect(capture.systemPrompt).toContain("git rev-parse --show-toplevel");
    },
  );

  it("rejects an identity changed to another worktree before spawning", async () => {
    writeAgent(fx.worktree, "worker");
    store.createPlan(fx.worktree, "docs/plan.md", undefined, resolveWorkspace(fx.worktree, fx.worktree));
    store.updatePlan(fx.worktree, { workspace: resolveWorkspace(fx.otherWorktree, fx.otherWorktree) });

    await expect(spawnAgents([{ agent: "crew-worker", task: "Run task" }], fx.worktree))
      .rejects.toMatchObject({ code: "workspace_identity_mismatch" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary child launches unchanged when the plan has no workspace", async () => {
    const dirs = createTempCrewDirs();
    writeAgent(dirs.cwd, "worker");
    store.createPlan(dirs.cwd, "docs/plan.md");

    await spawnAgents([{ agent: "crew-worker", task: "Run task" }], dirs.cwd);

    const capture = captures[0]!;
    expect(capture.options.cwd).toBe(dirs.cwd);
    expect(capture.options.env).not.toHaveProperty("PI_CREW_WORKSPACE_ROOT");
    expect(capture.systemPrompt).toBe("You are a test worker.");
  });

  it("returns workspace_mismatch before work and leaves ready tasks todo", async () => {
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    store.createPlan(fx.worktree, "docs/plan.md", undefined, identity);
    const task = store.createTask(fx.worktree, "Ready task");
    store.updatePlan(fx.worktree, { workspace: resolveWorkspace(fx.otherWorktree, fx.otherWorktree) });
    workExecute.mockReset();

    const response = await executeCrewAction(
      "work", {}, registeredState(), dirs(fx.worktree),
      { cwd: fx.worktree, hasUI: false, ui: {} } as any,
      () => {}, () => {}, vi.fn(),
    );

    expect(response.details.error).toBe("workspace_mismatch");
    expect(workExecute).not.toHaveBeenCalled();
    expect(store.getTask(fx.worktree, task.id)?.status).toBe("todo");
  });
});

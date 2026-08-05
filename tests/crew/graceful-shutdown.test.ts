import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";

function writeWorkerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-worker
description: Test worker
crewRole: worker
---
You are a worker.
`);
}

function createDirs(cwd: string) {
  const base = path.join(cwd, ".pi", "messenger");
  const registry = path.join(base, "registry");
  const inbox = path.join(base, "inbox");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  return { base, registry, inbox };
}

type MockLobbyProcess = EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
};

function mockLobbyProcesses(): MockLobbyProcess[] {
  const processes: MockLobbyProcess[] = [];
  vi.doMock("node:child_process", () => ({
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as MockLobbyProcess;
      proc.pid = 4242 + processes.length;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.exitCode = null;
      proc.kill = vi.fn((signal?: NodeJS.Signals) => {
        proc.killed = true;
        proc.exitCode = signal === "SIGKILL" ? 137 : 143;
        queueMicrotask(() => {
          proc.emit("exit", proc.exitCode);
          proc.emit("close", proc.exitCode);
        });
        return true;
      });
      processes.push(proc);
      return proc;
    }),
  }));
  return processes;
}

function closeLobbyProcess(proc: MockLobbyProcess, exitCode: number): void {
  proc.exitCode = exitCode;
  proc.emit("close", exitCode);
}

describe("crew/graceful shutdown", () => {
  let dirs: TempCrewDirs;

  beforeEach(() => {
    dirs = createTempCrewDirs();
    vi.restoreAllMocks();
  });

  it("raceTimeout returns true when promise resolves before timeout and false on timeout", async () => {
    const { raceTimeout } = await import("../../crew/agents.ts");

    const fast = raceTimeout(new Promise<void>(resolve => {
      setTimeout(resolve, 5);
    }), 100);
    const slow = raceTimeout(new Promise<void>(() => {}), 5);

    await expect(fast).resolves.toBe(true);
    await expect(slow).resolves.toBe(false);
  });

  it("abort signal writes shutdown inbox message and marks wasGracefullyShutdown", async () => {
    vi.resetModules();

    const spawnMock = vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        killed: boolean;
        exitCode: number | null;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      proc.pid = 4242;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.exitCode = null;
      proc.kill = (signal?: NodeJS.Signals) => {
        proc.killed = true;
        proc.exitCode = signal === "SIGKILL" ? 137 : 143;
        queueMicrotask(() => {
          proc.emit("exit", proc.exitCode);
          proc.emit("close", proc.exitCode);
        });
        return true;
      };
      return proc;
    });

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));

    const { spawnAgents } = await import("../../crew/agents.ts");

    writeWorkerAgent(dirs.cwd);

    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: {
        shutdownGracePeriodMs: 1,
      },
    }, null, 2));

    const messengerDirs = createDirs(dirs.cwd);
    const workerName = "worker-test";
    fs.mkdirSync(path.join(messengerDirs.inbox, workerName), { recursive: true });
    fs.writeFileSync(path.join(messengerDirs.registry, `${workerName}.json`), JSON.stringify({
      name: workerName,
      pid: 4242,
    }, null, 2));

    const controller = new AbortController();
    const resultPromise = spawnAgents([{
      agent: "crew-worker",
      task: "execute task",
      taskId: "task-1",
    }], dirs.cwd, {
      signal: controller.signal,
      messengerDirs: { registry: messengerDirs.registry, inbox: messengerDirs.inbox },
    });

    controller.abort();
    const results = await resultPromise;

    expect(results).toHaveLength(1);
    expect(results[0].taskId).toBe("task-1");
    expect(results[0].wasGracefullyShutdown).toBe(true);
    expect(results[0].exitCode).toBe(143);

    const inboxFiles = fs.readdirSync(path.join(messengerDirs.inbox, workerName));
    expect(inboxFiles.some(f => f.endsWith("-shutdown.json"))).toBe(true);

    const shutdownFile = inboxFiles.find(f => f.endsWith("-shutdown.json"))!;
    const shutdownPayload = JSON.parse(
      fs.readFileSync(path.join(messengerDirs.inbox, workerName, shutdownFile), "utf-8")
    );
    expect(shutdownPayload.text).toContain("SHUTDOWN REQUESTED");
    expect(shutdownPayload.from).toBe("crew-orchestrator");

    expect(fs.existsSync(path.join(messengerDirs.registry, `${workerName}.json`))).toBe(false);
  });

  it("result processing uses taskId and graceful shutdown branches correctly", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Task one", "Desc one");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
      store.updateTask(dirs.cwd, task.id, { status: "in_progress", assigned_to: "crew-worker" });
      return [{
        agent: "crew-worker",
        exitCode: 0,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "running" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: task.id,
        wasGracefullyShutdown: true,
      }];
    });

    const response = await workHandler.execute(
      { action: "work" },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    const reloaded = store.getTask(dirs.cwd, task.id);
    expect(reloaded?.status).toBe("todo");
    expect(reloaded?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([task.id]);
    expect(response.details.blocked).toEqual([]);
  });

  it("graceful non-zero exit with done task is credited as success; autonomous crash retries below the attempt limit", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Task one", "Desc one");
    const t2 = store.createTask(dirs.cwd, "Task two", "Desc two");

    let call = 0;
    vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
      call++;
      if (call === 1) {
        store.updateTask(dirs.cwd, t1.id, { status: "done" });
        return [{
          agent: "crew-worker",
          exitCode: 1,
          output: "",
          truncated: false,
          progress: {
            agent: "crew-worker",
            status: "failed" as const,
            recentTools: [],
            toolCallCount: 0,
            tokens: 0,
            durationMs: 0,
          },
          taskId: t1.id,
          wasGracefullyShutdown: true,
          error: "terminated",
        }];
      }

      store.updateTask(dirs.cwd, t2.id, { status: "in_progress", assigned_to: "crew-worker" });
      return [{
        agent: "crew-worker",
        exitCode: 1,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "failed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: t2.id,
        wasGracefullyShutdown: false,
        error: "crash",
      }];
    });

    const first = await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );
    expect(first.details.succeeded).toEqual([t1.id]);

    const second = await workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );
    expect(second.details.failed).toEqual([t2.id]);
    expect(second.details.blocked).toEqual([]);
    expect(store.getTask(dirs.cwd, t2.id)?.status).toBe("todo");
    expect(store.getTask(dirs.cwd, t2.id)?.assigned_to).toBeUndefined();
  });

  it("blocks a fresh exit-0 incomplete result at the attempt limit", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 1 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Fresh task", "Block an incomplete successful process");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async (tasks: Array<{ taskId?: string }>) => {
      for (const workerTask of tasks) {
        if (workerTask.taskId) store.startTask(dirs.cwd, workerTask.taskId, "crew-worker");
      }
      return tasks.map(workerTask => ({
        agent: "crew-worker",
        exitCode: 0,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "completed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: workerTask.taskId,
      }));
    });

    const response = await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
      blocked_reason: "Max attempts (1) reached",
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("counts and blocks a fresh startup failure that did not mutate the task", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 1 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Fresh task", "Count a provider startup failure");

    vi.spyOn(agents, "spawnAgents").mockResolvedValue([{
      agent: "crew-worker",
      exitCode: 1,
      output: "",
      truncated: false,
      progress: {
        agent: "crew-worker",
        status: "failed" as const,
        recentTools: [],
        toolCallCount: 0,
        tokens: 0,
        durationMs: 0,
      },
      taskId: task.id,
      error: "provider startup failed",
    }]);

    const response = await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
      blocked_reason: "Max attempts (1) reached",
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("counts a failed lobby assignment and unchanged fresh startup failure before blocking", async () => {
    vi.resetModules();
    mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 2 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Fresh task", "Count both failed launch paths");
    lobby.spawnLobbyWorker(dirs.cwd)!;

    const messengerDirs = createDirs(dirs.cwd);
    fs.rmSync(messengerDirs.inbox, { recursive: true });
    fs.writeFileSync(messengerDirs.inbox, "not a directory");
    vi.spyOn(agents, "spawnAgents").mockResolvedValue([{
      agent: "crew-worker",
      exitCode: 1,
      output: "",
      truncated: false,
      progress: {
        agent: "crew-worker",
        status: "failed" as const,
        recentTools: [],
        toolCallCount: 0,
        tokens: 0,
        durationMs: 0,
      },
      taskId: task.id,
      error: "provider startup failed",
    }]);

    const response = await workHandler.execute(
      { action: "work", concurrency: 1 },
      messengerDirs,
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 2,
      blocked_reason: "Max attempts (2) reached",
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("blocks a fresh worker failure at the attempt limit and clears ownership", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 1 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Fresh task", "Block after one failed attempt");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async (tasks: Array<{ taskId?: string }>) => {
      for (const workerTask of tasks) {
        if (workerTask.taskId) store.startTask(dirs.cwd, workerTask.taskId, "crew-worker");
      }
      return tasks.map(workerTask => ({
        agent: "crew-worker",
        exitCode: 1,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "failed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: workerTask.taskId,
        error: "crash",
      }));
    });

    const response = await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
      blocked_reason: "Max attempts (1) reached",
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("autonomous mode stops with manual reason when signal is aborted", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");
    const state = await import("../../crew/state.ts");

    state.autonomousState.active = false;
    state.autonomousState.cwd = null;
    state.autonomousState.waveNumber = 0;
    state.autonomousState.waveHistory = [];
    state.autonomousState.startedAt = null;
    state.autonomousState.stoppedAt = null;
    state.autonomousState.stopReason = null;
    state.autonomousState.concurrency = 2;
    state.autonomousState.autoOverlayPending = false;
    state.autonomousState.pid = null;

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Task one", "Desc one");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
      store.updateTask(dirs.cwd, task.id, { status: "in_progress", assigned_to: "crew-worker" });
      return [{
        agent: "crew-worker",
        exitCode: 1,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "failed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: task.id,
        wasGracefullyShutdown: true,
      }];
    });

    const controller = new AbortController();
    controller.abort();

    const appendEntry = vi.fn();
    const response = await workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      appendEntry,
      controller.signal,
    );

    expect(state.autonomousState.active).toBe(false);
    expect(state.autonomousState.stopReason).toBe("manual");
    expect(appendEntry).toHaveBeenCalledWith("crew-state", state.autonomousState);
    expect(response.content[0].text).toContain("Autonomous mode stopped (cancelled).");
  });

  it("clamps fractional concurrency and passes only available work slots to spawnAgents", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const state = await import("../../crew/state.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    store.createTask(dirs.cwd, "Task one", "Desc one");
    store.createTask(dirs.cwd, "Task two", "Desc two");
    store.createTask(dirs.cwd, "Task three", "Desc three");

    const spawnSpy = vi.spyOn(agents, "spawnAgents").mockResolvedValue([]);

    await workHandler.execute(
      { action: "work", concurrency: 1.8 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(state.autonomousState.concurrency).toBe(1);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const workerTasks = spawnSpy.mock.calls[0][0] as Array<{ taskId: string }>;
    expect(workerTasks).toHaveLength(1);
  });

  it("reconciles completed_count before returning from a no-ready wave", async () => {
    const store = await import("../../crew/store.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Task one", "Desc one");
    const t2 = store.createTask(dirs.cwd, "Task two", "Desc two");

    store.startTask(dirs.cwd, t1.id, "WorkerA");
    store.completeTask(dirs.cwd, t1.id, "Done");
    store.startTask(dirs.cwd, t2.id, "WorkerB");
    store.completeTask(dirs.cwd, t2.id, "Done");

    store.updatePlan(dirs.cwd, { completed_count: 0 });
    expect(store.getPlan(dirs.cwd)?.completed_count).toBe(0);

    const response = await workHandler.execute(
      { action: "work" },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getPlan(dirs.cwd)?.completed_count).toBe(2);
    expect(response.content[0].text).toContain("All tasks are done");
  });

  it("reconciles completed_count after worker results are processed", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Task one", "Desc one");
    const t2 = store.createTask(dirs.cwd, "Task two", "Desc two");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async (tasks: Array<{ taskId?: string }>) => {
      for (const t of tasks) {
        if (t.taskId) {
          store.updateTask(dirs.cwd, t.taskId, { status: "done" });
        }
      }
      return tasks.map(t => ({
        agent: "crew-worker",
        exitCode: 0,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "completed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: t.taskId,
      }));
    });

    const response = await workHandler.execute(
      { action: "work", concurrency: 2 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getPlan(dirs.cwd)?.completed_count).toBe(2);
    expect(response.content[0].text).toContain("**Progress:** 2/2");
    expect(response.details.succeeded).toEqual([t1.id, t2.id]);
  });

  it("auto-blocks tasks that exceed maxAttemptsPerTask before assigning to workers", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Flaky task", "Keeps failing");

    store.updateTask(dirs.cwd, t1.id, { attempt_count: 5 });

    const spawnSpy = vi.spyOn(agents, "spawnAgents").mockImplementation(async () => []);

    const response = await workHandler.execute(
      { action: "work" },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    const reloaded = store.getTask(dirs.cwd, t1.id);
    expect(reloaded?.status).toBe("blocked");
    expect(reloaded?.blocked_reason).toContain("Max attempts");
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("No ready tasks");
  });

  it("worker exit 0 with task still in_progress resets to todo", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Abandoned task", "Worker forgot task.done");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async (tasks: Array<{ taskId?: string }>) => {
      for (const t of tasks) {
        if (t.taskId) store.startTask(dirs.cwd, t.taskId, "Worker");
      }
      return tasks.map(t => ({
        agent: "crew-worker",
        exitCode: 0,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "running" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: t.taskId,
      }));
    });

    const response = await workHandler.execute(
      { action: "work" },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    const reloaded = store.getTask(dirs.cwd, t1.id);
    expect(reloaded?.status).toBe("todo");
    expect(reloaded?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([t1.id]);
  });

  it("graceful shutdown with non-zero exit and in_progress task resets to todo and reports failed", async () => {
    const store = await import("../../crew/store.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const t1 = store.createTask(dirs.cwd, "Interrupted task", "Graceful non-zero");

    vi.spyOn(agents, "spawnAgents").mockImplementation(async (tasks: Array<{ taskId?: string }>) => {
      for (const t of tasks) {
        if (t.taskId) store.startTask(dirs.cwd, t.taskId, "Worker");
      }
      return tasks.map(t => ({
        agent: "crew-worker",
        exitCode: 1,
        output: "",
        truncated: false,
        progress: {
          agent: "crew-worker",
          status: "failed" as const,
          recentTools: [],
          toolCallCount: 0,
          tokens: 0,
          durationMs: 0,
        },
        taskId: t.taskId,
        wasGracefullyShutdown: true,
        error: "terminated",
      }));
    });

    const response = await workHandler.execute(
      { action: "work" },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    const reloaded = store.getTask(dirs.cwd, t1.id);
    expect(reloaded?.status).toBe("todo");
    expect(reloaded?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([t1.id]);
    expect(response.details.blocked).toEqual([]);
  });

  it("does not assign lobby work when the signal is already aborted", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Do not assign after cancellation");
    const lobbyWorker = lobby.spawnLobbyWorker(dirs.cwd)!;
    const controller = new AbortController();
    controller.abort();

    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
      controller.signal,
    );

    await new Promise(resolve => setImmediate(resolve));
    const assignedTaskId = lobbyWorker.assignedTaskId;
    closeLobbyProcess(processes[0], 0);
    await execution;

    expect(assignedTaskId).toBeNull();
    expect(processes[0].kill).not.toHaveBeenCalled();
    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 0,
    });
  });

  it("aborts only assigned work-managed lobby workers and recovers the task once", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Cancel after assignment");
    const assignedWorker = lobby.spawnLobbyWorker(dirs.cwd)!;
    const idleWorker = lobby.spawnLobbyWorker(dirs.cwd)!;
    const controller = new AbortController();

    let settled = false;
    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
      controller.signal,
    ).then(response => {
      settled = true;
      return response;
    });

    await new Promise(resolve => setImmediate(resolve));
    expect(assignedWorker.assignedTaskId).toBe(task.id);
    expect(idleWorker.assignedTaskId).toBeNull();

    controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    const settledAfterAbort = settled;
    if (!settled) closeLobbyProcess(processes[0], 143);
    const response = await execution;

    expect(settledAfterAbort).toBe(true);
    expect(processes[0].kill).toHaveBeenCalledTimes(1);
    expect(processes[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(processes[1].kill).not.toHaveBeenCalled();
    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([task.id]);
    expect(response.details.blocked).toEqual([]);
    const recoveries = store.getTaskProgress(dirs.cwd, task.id)
      ?.split("\n")
      .filter(line => line.includes("Task interrupted (shutdown), reset to todo"));
    expect(recoveries).toHaveLength(1);

    closeLobbyProcess(processes[1], 0);
  });

  it("recovers a work-managed lobby task once after a non-zero exit", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Recover a crashed lobby assignment");
    lobby.spawnLobbyWorker(dirs.cwd)!;
    const updateSpy = vi.spyOn(store, "updateTask");

    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    await new Promise(resolve => setImmediate(resolve));
    closeLobbyProcess(processes[0], 1);
    const response = await execution;

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([task.id]);
    expect(updateSpy.mock.calls.filter(([, id, patch]) =>
      id === task.id && patch.status === "todo"
    )).toHaveLength(1);
    const recoveries = store.getTaskProgress(dirs.cwd, task.id)
      ?.split("\n")
      .filter(line => line.includes("reset to todo"));
    expect(recoveries).toHaveLength(1);
  });

  it("blocks a work-managed lobby task at the attempt limit after an exit-0 incomplete result", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 1 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Block an incomplete successful process");
    lobby.spawnLobbyWorker(dirs.cwd)!;

    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    await new Promise(resolve => setImmediate(resolve));
    closeLobbyProcess(processes[0], 0);
    const response = await execution;

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
      blocked_reason: "Max attempts (1) reached",
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("blocks a work-managed lobby task at the attempt limit after a non-zero exit", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
      work: { maxAttemptsPerTask: 1 },
    }));
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Block a repeatedly crashing lobby assignment");
    lobby.spawnLobbyWorker(dirs.cwd)!;
    const updateSpy = vi.spyOn(store, "updateTask");

    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    await new Promise(resolve => setImmediate(resolve));
    closeLobbyProcess(processes[0], 1);
    const response = await execution;

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.blocked).toEqual([task.id]);
    expect(updateSpy.mock.calls.filter(([, id, patch]) =>
      id === task.id && patch.status === "blocked"
    )).toHaveLength(1);
  });

  it("cleans up and recovers assigned lobby work when fresh spawning rejects", async () => {
    vi.resetModules();

    const processes: MockLobbyProcess[] = [];
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const proc = new EventEmitter() as MockLobbyProcess;
        proc.pid = 4242;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.exitCode = null;
        proc.kill = vi.fn(() => {
          proc.killed = true;
          return true;
        });
        processes.push(proc);
        return proc;
      }),
    }));

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const lobbyTask = store.createTask(dirs.cwd, "Lobby task", "Recover after aggregate failure");
    store.createTask(dirs.cwd, "Fresh task", "Make fresh spawning reject");
    const lobbyWorker = lobby.spawnLobbyWorker(dirs.cwd)!;
    const originalError = new Error("fresh spawn failed");
    vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
      expect(lobbyWorker.assignedTaskId).toBe(lobbyTask.id);
      throw originalError;
    });
    const updateSpy = vi.spyOn(store, "updateTask");
    const controller = new AbortController();
    const addListenerSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeListenerSpy = vi.spyOn(controller.signal, "removeEventListener");

    let settled = false;
    const execution = workHandler.execute(
      { action: "work", concurrency: 2 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
      controller.signal,
    );
    void execution.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await new Promise(resolve => setImmediate(resolve));
    expect(processes[0].kill).toHaveBeenCalledTimes(1);
    expect(processes[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(settled).toBe(false);

    closeLobbyProcess(processes[0], 143);
    await expect(execution).rejects.toBe(originalError);

    const abortListener = addListenerSpy.mock.calls[0][1];
    expect(removeListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeListenerSpy).toHaveBeenCalledWith("abort", abortListener);
    expect(store.getTask(dirs.cwd, lobbyTask.id)).toMatchObject({
      status: "todo",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, lobbyTask.id)?.assigned_to).toBeUndefined();
    expect(updateSpy.mock.calls.filter(([, id, patch]) =>
      id === lobbyTask.id && patch.status === "todo"
    )).toHaveLength(1);
    const recoveries = store.getTaskProgress(dirs.cwd, lobbyTask.id)
      ?.split("\n")
      .filter(line => line.includes("Task interrupted (shutdown), reset to todo"));
    expect(recoveries).toHaveLength(1);
  });

  it("records a non-zero lobby close as retried in the autonomous wave below the attempt limit", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const state = await import("../../crew/state.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Classify a crashed lobby assignment");
    lobby.spawnLobbyWorker(dirs.cwd)!;

    const execution = workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      vi.fn(),
    );

    await new Promise(resolve => setImmediate(resolve));
    closeLobbyProcess(processes[0], 1);
    const response = await execution;

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(response.details.failed).toEqual([task.id]);
    expect(response.details.blocked).toEqual([]);
    expect(state.autonomousState.waveHistory.at(-1)).toMatchObject({
      tasksAttempted: [task.id],
      succeeded: [],
      failed: [task.id],
      blocked: [],
    });
  });

  it("does not stop autonomous work before an assigned lobby worker closes", async () => {
    vi.resetModules();
    const processes = mockLobbyProcesses();

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const state = await import("../../crew/state.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Wait for the lobby result before stopping");
    lobby.spawnLobbyWorker(dirs.cwd)!;
    const appendEntry = vi.fn();

    const execution = workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      appendEntry,
    );

    await new Promise(resolve => setImmediate(resolve));
    expect(store.getTask(dirs.cwd, task.id)?.status).toBe("in_progress");
    expect(state.autonomousState.active).toBe(true);
    expect(appendEntry).not.toHaveBeenCalledWith("crew_wave_blocked", expect.anything());

    closeLobbyProcess(processes[0], 1);
    await execution;

    expect(state.autonomousState.active).toBe(true);
    expect(state.autonomousState.stopReason).toBeNull();
    expect(appendEntry).toHaveBeenCalledWith("crew_wave_continue", expect.objectContaining({
      readyTasks: [task.id],
    }));
  });

  it("waits for an assigned lobby worker to close before completing the work wave", async () => {
    vi.resetModules();

    let lobbyProc: (EventEmitter & { exitCode: number | null }) | undefined;
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const proc = new EventEmitter() as EventEmitter & {
          pid: number;
          stdout: EventEmitter;
          stderr: EventEmitter;
          killed: boolean;
          exitCode: number | null;
          kill: () => boolean;
        };
        proc.pid = 4242;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.exitCode = null;
        proc.kill = () => false;
        lobbyProc = proc;
        return proc;
      }),
    }));

    const store = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Lobby task", "Wait for the lobby worker");
    const lobbyWorker = lobby.spawnLobbyWorker(dirs.cwd)!;

    let settled = false;
    const execution = workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    ).then(response => {
      settled = true;
      return response;
    });

    await new Promise(resolve => setImmediate(resolve));
    expect(lobbyWorker.assignedTaskId).toBe(task.id);
    expect(lobbyWorker.managedByWork).toBe(true);
    expect(settled).toBe(false);

    lobbyProc!.exitCode = 0;
    lobbyProc!.emit("close", 0);

    const response = await execution;
    expect(response.details.failed).toEqual([task.id]);
  });
});

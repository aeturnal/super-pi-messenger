import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as crewStore from "../../crew/store.js";
import {
  readAttempt,
  readSchedulerRecord,
  updateAttempt as persistAttempt,
  writeSchedulerRecord,
} from "../../crew/execution/store.js";
import { buildPiToolArgs } from "../../crew/agents.js";
import { launchAttempt, resolveLobbyAttemptIdentity } from "../../crew/spawn.js";
import type { AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import { findWorkerByAttempt, type LobbyWorkerEntry, type WorkerEntry } from "../../crew/registry.js";
import type { CrewAgentConfig } from "../../crew/utils/discover.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown>; proc: EventEmitter & Record<string, any> }> = [];
let currentAgent: CrewAgentConfig;
let beforeSpawn: (() => void) | undefined;
let spawnedPid: number | undefined;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
    beforeSpawn?.();
    const proc = new EventEmitter() as EventEmitter & Record<string, any>;
    proc.pid = spawnedPid;
    proc.exitCode = null;
    proc.killed = false;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn(() => true);
    spawned.push({ command, args, options, proc });
    return proc;
  }),
}));

vi.mock("../../crew/utils/discover.js", () => ({
  discoverCrewAgents: vi.fn(() => [currentAgent]),
  discoverCrewSkills: vi.fn(() => []),
}));

vi.mock("../../crew/utils/config.js", () => ({
  loadCrewConfig: vi.fn(() => ({
    concurrency: { workers: 1 },
    models: {},
    artifacts: { enabled: false },
    work: {},
    coordination: "chatty",
  })),
  getTruncationForRole: vi.fn(() => 10_000),
}));

function agent(tools?: string[]): CrewAgentConfig {
  return {
    name: "crew-worker",
    description: "worker",
    systemPrompt: "",
    tools,
    source: "extension",
    filePath: "/extension/crew-worker.md",
    crewRole: "worker",
  };
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) throw new Error(`Missing ${name}`);
  return args[index + 1];
}

async function launch(kind: "ordinary" | "lobby", config: CrewAgentConfig): Promise<string[]> {
  currentAgent = config;
  spawned.length = 0;
  vi.resetModules();

  if (kind === "lobby") {
    const { spawnLobbyWorker } = await import("../../crew/lobby.js");
    expect(spawnLobbyWorker("/test/cwd", "stand by")).not.toBeNull();
  } else {
    const { spawnAgents } = await import("../../crew/agents.js");
    const result = spawnAgents([{ agent: "crew-worker", task: "do work" }], "/test/cwd");
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].proc.exitCode = 0;
    spawned[0].proc.emit("close", 0, null);
    await result;
  }

  expect(spawned).toHaveLength(1);
  expect(spawned[0].command).toBe("pi");
  return spawned[0].args;
}

const EXTENSION_DIR = path.resolve(".");

describe("shared Pi launch arguments", () => {
  beforeEach(() => {
    currentAgent = agent();
    beforeSpawn = undefined;
    spawned.length = 0;
  });

  it.each(["ordinary", "lobby"] as const)(
    "preserves declared named tools and selects pi_messenger for %s workers",
    async kind => {
      const args = await launch(kind, agent(["read", "write", "edit", "bash", "pi_messenger"]));
      expect(option(args, "--tools").split(",")).toEqual(["read", "write", "edit", "bash", "pi_messenger"]);
      expect(args).toContain("--extension");
      expect(args).toContain(EXTENSION_DIR);
    },
  );

  it("keeps named extension tools in --tools and path extensions in --extension", () => {
    expect(buildPiToolArgs(agent(["read", "pi_messenger", "/tmp/custom.ts"]), EXTENSION_DIR)).toEqual([
      "--tools", "read,pi_messenger",
      "--extension", "/tmp/custom.ts",
      "--extension", EXTENSION_DIR,
    ]);
  });

  it("retains declared restrictions instead of enabling every tool", () => {
    expect(buildPiToolArgs(agent(["read", "pi_messenger"]), EXTENSION_DIR)).toEqual([
      "--tools", "read,pi_messenger", "--extension", EXTENSION_DIR,
    ]);
  });

  it("does not emit an empty --tools option", () => {
    expect(buildPiToolArgs(agent([]), EXTENSION_DIR)).toEqual(["--extension", EXTENSION_DIR]);
    expect(buildPiToolArgs(agent(), EXTENSION_DIR)).toEqual(["--extension", EXTENSION_DIR]);
  });

  it("ordinary and lobby workers consume the same pure tool contract", async () => {
    const config = agent(["read", "custom_named_tool", "./extensions/custom.ts"]);
    const ordinary = await launch("ordinary", config);
    const lobby = await launch("lobby", config);
    const expected = buildPiToolArgs(config, EXTENSION_DIR);

    expect(ordinary.filter(arg => expected.includes(arg))).toEqual(expected);
    expect(lobby.filter(arg => expected.includes(arg))).toEqual(expected);
  });
});

const runId = "11111111-1111-4111-8111-111111111111";
const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignAttemptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function activeScheduler(): SchedulerRecord {
  return {
    version: 1, runId, controllerId: "controller-a", leaseEpoch: 3, mode: "wave",
    waveSnapshotTaskIds: ["task-1"], waveTargetState: {}, desiredConcurrencyOverride: null,
    activeAttemptIds: [], cancellationIntent: null,
  };
}

function lobbyWorker(cwd: string): LobbyWorkerEntry {
  const proc = new EventEmitter() as EventEmitter & Record<string, any>;
  proc.pid = 5151;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => true);
  return {
    type: "lobby", lobbyId: "lobby-a", name: "LobbyWorker", cwd, proc: proc as any,
    taskId: "__lobby-lobby-a__", attemptId: null, assignedTaskId: null,
    coordination: "chatty", startedAt: Date.now(), promptTmpDir: null, aliveFile: null,
  };
}

describe("durable attempt launch", () => {
  beforeEach(() => {
    currentAgent = agent(["read", "pi_messenger"]);
    beforeSpawn = undefined;
    spawnedPid = 4242;
    spawned.length = 0;
  });

  it("persists charged ownership before spawn and attaches the PID afterward", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    vi.resetModules();

    beforeSpawn = () => {
      expect(crewStore.getTask(cwd, task.id)).toMatchObject({
        status: "in_progress", assigned_to: "WorkerA", current_attempt_id: attemptId,
        attempt_count: 1,
      });
      expect(readAttempt(cwd, attemptId)).toMatchObject({
        state: "starting", pid: null, attemptCharged: true, rollbackApplied: false,
      });
      expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([attemptId]);
    };

    const launched = launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    });

    expect(launched.proc.pid).toBe(4242);
    expect(readAttempt(cwd, attemptId)).toMatchObject({ state: "running", pid: 4242 });
    expect(crewStore.getTask(cwd, task.id)?.attempt_count).toBe(1);
    expect(findWorkerByAttempt(cwd, attemptId)).toMatchObject({
      taskId: task.id, attemptId, name: "WorkerA", proc: launched.proc,
    });
    expect(spawned[0].options.env).toMatchObject({
      PI_CREW_ATTEMPT_ID: attemptId,
      PI_CREW_RUN_ID: runId,
      PI_CREW_CONTROLLER_ID: "controller-a",
    });
  });

  it("uses guarded rollback when spawn reports an error before the child owns work", async () => {
    const { cwd } = createTempCrewDirs();
    spawnedPid = undefined;
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    vi.resetModules();

    const launched = launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    });
    launched.proc.emit("error", new Error("ENOENT"));

    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
    expect(readAttempt(cwd, attemptId)?.rollbackApplied).toBe(true);
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
  });

  it("compensates task ownership when attempt creation fails", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    }, {
      createAttempt: (_cwd: string, _attempt: AttemptRecord) => {
        throw new Error("create attempt failed");
      },
    })).toThrow("create attempt failed");

    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
    expect(crewStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
    expect(readAttempt(cwd, attemptId)).toBeNull();
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
    expect(spawned).toHaveLength(0);
  });

  it("compensates a scheduler activation that persists and then fails", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    let activationWrites = 0;

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    }, {
      writeSchedulerRecord: (targetCwd: string, record: SchedulerRecord) => {
        writeSchedulerRecord(targetCwd, record);
        if (record.activeAttemptIds.includes(attemptId) && activationWrites++ === 0) {
          throw new Error("scheduler activation failed");
        }
      },
    })).toThrow("scheduler activation failed");

    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
    expect(crewStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
    expect(readAttempt(cwd, attemptId)).toMatchObject({ rollbackApplied: true });
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
    expect(spawned).toHaveLength(0);
  });

  it("does not roll back after an ordinary child exists when PID persistence fails", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    }, {
      updateAttempt: (targetCwd: string, targetAttemptId: string, mutate: (current: AttemptRecord) => AttemptRecord) => {
        const current = readAttempt(targetCwd, targetAttemptId)!;
        const candidate = mutate(current);
        if (candidate.pid !== null) throw new Error("PID persistence failed");
        return persistAttempt(targetCwd, targetAttemptId, mutate);
      },
    })).toThrow("PID persistence failed");

    expect(spawned).toHaveLength(1);
    expect(spawned[0].proc.listenerCount("error")).toBe(1);
    expect(spawned[0].proc.listenerCount("close")).toBe(1);
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({
      status: "in_progress", current_attempt_id: attemptId, attempt_count: 1,
    });
    expect(readAttempt(cwd, attemptId)).toMatchObject({ rollbackApplied: false, state: "starting" });
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([attemptId]);
  });

  it("does not roll back a delivered lobby assignment when registry insertion fails", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    const worker = lobbyWorker(cwd);

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: worker.name, prompt: "Do task one", lobbyWorker: worker,
    }, {
      registerWorker: (_entry: WorkerEntry) => {
        throw new Error("registry insertion failed");
      },
    })).toThrow("registry insertion failed");

    const inbox = path.join(cwd, ".pi", "messenger", "inbox", worker.name);
    expect(fs.readdirSync(inbox)).toHaveLength(1);
    expect(worker.proc.listenerCount("error")).toBe(1);
    expect(worker.proc.listenerCount("close")).toBe(1);
    expect(resolveLobbyAttemptIdentity(cwd, { PI_LOBBY_ID: worker.lobbyId })).toMatchObject({ attemptId });
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({
      status: "in_progress", current_attempt_id: attemptId, attempt_count: 1,
    });
    expect(readAttempt(cwd, attemptId)?.rollbackApplied).toBe(false);
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([attemptId]);
  });

  it("routes ordinary child close through durable reconciliation", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    vi.resetModules();

    const launched = launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: "WorkerA", prompt: "Do task one",
    });
    (launched.proc as any).exitCode = 0;
    launched.proc.emit("close", 0, null);

    expect(crewStore.getTask(cwd, task.id)).toMatchObject({
      status: "blocked", blocked_code: "protocol_incomplete", attempt_count: 1,
    });
    expect(readAttempt(cwd, attemptId)).toMatchObject({ state: "closed", exitCode: 0, signal: null });
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
    expect(findWorkerByAttempt(cwd, attemptId)).toBeNull();
  });

  it("persists trusted lobby identity before delivering the inbox assignment", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    const worker = lobbyWorker(cwd);
    let identityAtDelivery: ReturnType<typeof resolveLobbyAttemptIdentity> = null;

    const launched = launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: worker.name, prompt: "Do task one", lobbyWorker: worker,
    }, {
      writeInboxFile(filePath: string, contents: string) {
        identityAtDelivery = resolveLobbyAttemptIdentity(cwd, { PI_LOBBY_ID: worker.lobbyId });
        fs.writeFileSync(filePath, contents);
      },
    });

    const inbox = path.join(cwd, ".pi", "messenger", "inbox", worker.name);
    const assignmentFiles = fs.readdirSync(inbox);
    expect(identityAtDelivery).toEqual({
      version: 1, lobbyId: worker.lobbyId, taskId: task.id, attemptId,
      runId, controllerId: "controller-a",
    });
    expect(assignmentFiles).toHaveLength(1);
    expect(worker).toMatchObject({ assignedTaskId: task.id, attemptId });
    expect(launched.proc).toBe(worker.proc);
    expect(readAttempt(cwd, attemptId)).toMatchObject({ pid: 5151, state: "running" });
  });

  it("resolves lobby identity only from trusted PI_LOBBY_ID keyed state", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    const worker = lobbyWorker(cwd);

    launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: worker.name, prompt: "Do task one", lobbyWorker: worker,
    });
    const inbox = path.join(cwd, ".pi", "messenger", "inbox", worker.name);
    const assignment = path.join(inbox, fs.readdirSync(inbox)[0]);
    const forged = JSON.parse(fs.readFileSync(assignment, "utf8"));
    fs.writeFileSync(assignment, JSON.stringify({
      ...forged, attemptId: foreignAttemptId, runId: foreignAttemptId, controllerId: "attacker",
    }));

    expect(resolveLobbyAttemptIdentity(cwd, {
      PI_LOBBY_ID: worker.lobbyId,
      PI_CREW_ATTEMPT_ID: foreignAttemptId,
    })).toMatchObject({ attemptId, runId, controllerId: "controller-a" });
    expect(resolveLobbyAttemptIdentity(cwd, { PI_LOBBY_ID: "other-lobby" })).toBeNull();
  });

  it("removes only failed pre-delivery lobby handlers before retrying the warm process", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    const worker = lobbyWorker(cwd);
    const baselineErrorListeners = worker.proc.listenerCount("error");
    const baselineCloseListeners = worker.proc.listenerCount("close");

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: worker.name, prompt: "First delivery", lobbyWorker: worker,
    }, {
      writeInboxFile: () => {
        throw new Error("inbox delivery failed");
      },
    })).toThrow("inbox delivery failed");

    expect(worker.proc.listenerCount("error")).toBe(baselineErrorListeners);
    expect(worker.proc.listenerCount("close")).toBe(baselineCloseListeners);
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
    expect(readAttempt(cwd, attemptId)).toMatchObject({ state: "starting", rollbackApplied: true });

    launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId: foreignAttemptId, workerName: worker.name, prompt: "Actual delivery", lobbyWorker: worker,
    });
    expect(worker.proc.listenerCount("error")).toBe(baselineErrorListeners + 1);
    expect(worker.proc.listenerCount("close")).toBe(baselineCloseListeners + 1);

    worker.proc.emit("error", new Error("post-delivery process error"));
    (worker.proc as any).exitCode = 1;
    worker.proc.emit("close", 1, null);

    expect(readAttempt(cwd, attemptId)).toMatchObject({ state: "starting", rollbackApplied: true });
    expect(readAttempt(cwd, foreignAttemptId)).toMatchObject({ state: "closed", exitCode: 1 });
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({
      status: "blocked", blocked_code: "worker_crash", attempt_count: 1,
    });
    const events = fs.readFileSync(path.join(crewDir, "scheduler-events.jsonl"), "utf8")
      .trim().split("\n").map(line => JSON.parse(line));
    expect(events.filter(event => event.attemptId === attemptId)).toEqual([]);
    expect(events.filter(event => event.attemptId === foreignAttemptId)).toEqual([
      expect.objectContaining({ name: "task.worker_crash", attemptId: foreignAttemptId }),
    ]);
  });

  it("uses guarded rollback when lobby assignment fails before the child owns work", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Task one");
    writeSchedulerRecord(cwd, activeScheduler());
    const worker = lobbyWorker(cwd);
    const inbox = path.join(cwd, ".pi", "messenger", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, worker.name), "not a directory");
    vi.resetModules();

    expect(() => launchAttempt({
      cwd, runId, controllerId: "controller-a", leaseEpoch: 3, task,
      attemptId, workerName: worker.name, prompt: "Do task one", lobbyWorker: worker,
    })).toThrow();

    expect(crewStore.getTask(cwd, task.id)).toMatchObject({
      status: "todo", attempt_count: 0,
    });
    expect(crewStore.getTask(cwd, task.id)?.assigned_to).toBeUndefined();
    expect(crewStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
    expect(readAttempt(cwd, attemptId)).toMatchObject({ rollbackApplied: true });
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
  });
});

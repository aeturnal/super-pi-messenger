import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../lib.ts";
import * as crewStore from "../crew/store.ts";
import { autonomousState, startPlanningRun, clearPlanningState } from "../crew/state.ts";
import { createTempCrewDirs } from "./helpers/temp-dirs.ts";

const executeRevise = vi.hoisted(() => vi.fn(async () => ({ success: true, message: "Revised" })));

vi.mock("../crew/spawn.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../crew/spawn.ts")>();
  return { ...actual, spawnSingleWorker: vi.fn(), spawnWorkersForReadyTasks: vi.fn() };
});

vi.mock("../crew/lobby.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../crew/lobby.ts")>();
  return { ...actual, spawnLobbyWorker: vi.fn() };
});

vi.mock("../crew/handlers/revise.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../crew/handlers/revise.ts")>();
  return { ...actual, executeRevise };
});

import { MessengerOverlay } from "../overlay.ts";
import { spawnSingleWorker, spawnWorkersForReadyTasks } from "../crew/spawn.ts";
import { spawnLobbyWorker } from "../crew/lobby.ts";

const theme = { fg: (_color: string, text: string) => text } as any;

function createState(cwd: string): MessengerState {
  return {
    agentName: "Lead",
    registered: true,
    watcher: null,
    watcherRetries: 0,
    watcherRetryTimer: null,
    watcherDebounceTimer: null,
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    broadcastHistory: [],
    seenSenders: new Map(),
    model: "stale-provider/stale-model",
    cwd,
    scopeToFolder: false,
    isHuman: true,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  autonomousState.concurrency = 2;
});

describe("MessengerOverlay current host model routing", () => {
  it("uses the provider-qualified current model after a switch for manual worker launch", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const task = crewStore.createTask(cwd, "Launch manually");
    let currentModel = "openai-codex/gpt-5.6-terra";
    vi.mocked(spawnSingleWorker).mockReturnValue({ name: "WorkerOne" });
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );

    currentModel = "anthropic/claude-opus-4-6";
    overlay.handleInput("s");

    expect(spawnSingleWorker).toHaveBeenCalledWith(cwd, task.id, "anthropic/claude-opus-4-6");
    expect(spawnSingleWorker).not.toHaveBeenCalledWith(cwd, task.id, "stale-provider/stale-model");
    overlay.dispose();
  });

  it("uses the switched provider-qualified host model for a ready task after increasing concurrency", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const task = crewStore.createTask(cwd, "Launch ready task", undefined, undefined, { model: "task-override" });
    let currentModel = "openai-codex/gpt-5.6-terra";
    vi.mocked(spawnSingleWorker).mockReturnValue({ name: "WorkerOne" });
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );

    currentModel = "anthropic/claude-opus-4-6";
    overlay.handleInput("+");

    expect(crewStore.getTask(cwd, task.id)?.model).toBe("task-override");
    expect(spawnSingleWorker).toHaveBeenCalledWith(cwd, task.id, "anthropic/claude-opus-4-6");
    expect(spawnSingleWorker).not.toHaveBeenCalledWith(cwd, task.id, "stale-provider/stale-model");
    overlay.dispose();
  });

  it("uses the provider-qualified current model after a switch for a new lobby worker", () => {
    const { cwd } = createTempCrewDirs();
    let currentModel = "openai-codex/gpt-5.6-terra";
    vi.mocked(spawnLobbyWorker).mockReturnValue({ name: "LobbyOne" } as any);
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );

    currentModel = "anthropic/claude-opus-4-6";
    overlay.handleInput("+");

    expect(spawnLobbyWorker).toHaveBeenCalledWith(cwd, undefined, "anthropic/claude-opus-4-6");
    overlay.dispose();
  });

  it("uses the provider-qualified current model after a switch for auto-spawn", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Auto-spawn with current model");
    let currentModel = "openai-codex/gpt-5.6-terra";
    vi.mocked(spawnWorkersForReadyTasks).mockReturnValue({ assigned: 0, firstWorkerName: null, mutated: false });
    startPlanningRun(cwd, 1);
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );

    currentModel = "anthropic/claude-opus-4-6";
    clearPlanningState(cwd);
    overlay.render(80);

    expect(spawnWorkersForReadyTasks).toHaveBeenCalledWith(cwd, 1, "anthropic/claude-opus-4-6");
    overlay.dispose();
  });

  it("uses the provider-qualified current model after a switch for auto-refill", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const completed = crewStore.createTask(cwd, "Completing worker");
    crewStore.createTask(cwd, "Refill worker");
    crewStore.updateTask(cwd, completed.id, { status: "in_progress", assigned_to: "WorkerOne" });
    let currentModel = "openai-codex/gpt-5.6-terra";
    vi.mocked(spawnWorkersForReadyTasks).mockReturnValue({ assigned: 0, firstWorkerName: null, mutated: false });
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );
    overlay.render(80);

    currentModel = "anthropic/claude-opus-4-6";
    crewStore.updateTask(cwd, completed.id, { status: "done", assigned_to: undefined });
    overlay.render(80);

    expect(spawnWorkersForReadyTasks).toHaveBeenCalledWith(cwd, 1, "anthropic/claude-opus-4-6");
    overlay.dispose();
  });

  it("uses the provider-qualified current model after a switch for revision launch", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const task = crewStore.createTask(cwd, "Revise with current model");
    let currentModel = "openai-codex/gpt-5.6-terra";
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
      () => currentModel,
    );

    currentModel = "anthropic/claude-opus-4-6";
    overlay.handleInput("p");
    overlay.handleInput("\r");

    await vi.waitFor(() => {
      expect(executeRevise).toHaveBeenCalledWith(cwd, task.id, undefined, "Lead", "anthropic/claude-opus-4-6");
    });
    overlay.dispose();
  });
});

describe("MessengerOverlay task snapshots", () => {
  it("reads the task directory once during an ordinary render", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Render from one snapshot");
    const getTasks = vi.spyOn(crewStore, "getTasks");
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );

    overlay.render(80);

    expect(getTasks).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it("reloads the auto-spawn result before auto-refill checks task readiness", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Auto-spawn first");
    crewStore.createTask(cwd, "Auto-refill second");
    const firstTask = crewStore.getTasks(cwd)[0]!;
    const readySnapshots = vi.spyOn(crewStore, "getReadyTasksFrom");

    vi.mocked(spawnWorkersForReadyTasks).mockImplementationOnce(() => {
      crewStore.updateTask(cwd, firstTask.id, { status: "in_progress", assigned_to: "WorkerOne" });
      return { assigned: 1, firstWorkerName: "WorkerOne", mutated: true };
    }).mockReturnValue({ assigned: 0, firstWorkerName: null, mutated: false });

    startPlanningRun(cwd, 1);
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );
    clearPlanningState(cwd);
    (overlay as any).prevInProgressCount = 2;

    overlay.render(80);

    expect(readySnapshots.mock.calls[1]?.[0].map(task => task.status)).toEqual(["in_progress", "todo"]);
    overlay.dispose();
  });

  it("renders an auto-refill assignment in the same frame", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Completed work");
    crewStore.createTask(cwd, "Refilled work");
    const [completedTask, refilledTask] = crewStore.getTasks(cwd);
    crewStore.updateTask(cwd, completedTask!.id, { status: "in_progress", assigned_to: "WorkerOne" });
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );
    overlay.render(80);
    crewStore.updateTask(cwd, completedTask!.id, { status: "done", assigned_to: undefined });
    vi.mocked(spawnWorkersForReadyTasks).mockImplementation(() => {
      crewStore.updateTask(cwd, refilledTask!.id, { status: "in_progress", assigned_to: "WorkerTwo" });
      return { assigned: 1, firstWorkerName: "WorkerTwo", mutated: true };
    });

    const frame = overlay.render(80).join("\n");

    expect(frame).toContain("● task-2  Refilled work (WorkerTwo)");
    overlay.dispose();
  });

  it("reloads failed lobby assignment metadata before detail output", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Retry the lobby assignment");
    const task = crewStore.getTasks(cwd)[0]!;

    vi.mocked(spawnWorkersForReadyTasks).mockImplementation(() => {
      crewStore.updateTask(cwd, task.id, {
        status: "in_progress",
        started_at: new Date().toISOString(),
        base_commit: "base-before-delivery",
        assigned_to: "LobbyOne",
        attempt_count: 1,
      });
      crewStore.updateTask(cwd, task.id, { status: "todo", assigned_to: undefined });
      return { assigned: 0, firstWorkerName: null, mutated: true };
    });

    startPlanningRun(cwd, 1);
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );
    clearPlanningState(cwd);
    (overlay as any).crewViewState.mode = "detail";

    const frame = overlay.render(80).join("\n");

    expect(frame).toContain("Status: todo  │  Attempts: 1");
    overlay.dispose();
  });

  it("reloads tasks after auto-spawn before rendering the completed planning frame", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Implement snapshot reload");
    const task = crewStore.getTasks(cwd)[0]!;

    vi.mocked(spawnWorkersForReadyTasks).mockImplementation(() => {
      crewStore.updateTask(cwd, task.id, { status: "in_progress", assigned_to: "WorkerOne" });
      return { assigned: 1, firstWorkerName: "WorkerOne", mutated: true };
    });

    startPlanningRun(cwd, 1);
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );
    clearPlanningState(cwd);

    const frame = overlay.render(80).join("\n");

    expect(frame).toContain("● task-1  Implement snapshot reload (WorkerOne)");
    overlay.dispose();
  });
});

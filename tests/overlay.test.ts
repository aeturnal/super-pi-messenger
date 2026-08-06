import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../lib.ts";
import * as crewStore from "../crew/store.ts";
import { autonomousState, startPlanningRun, clearPlanningState } from "../crew/state.ts";
import { createTempCrewDirs } from "./helpers/temp-dirs.ts";

const executeRevise = vi.hoisted(() => vi.fn(async () => ({ success: true, message: "Revised" })));
const executeReviseTree = vi.hoisted(() => vi.fn(async () => ({ success: true, message: "Revised tree" })));

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
  return { ...actual, executeRevise, executeReviseTree };
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
  it("uses the provider-qualified current model after a switch for an explicit task-start key", () => {
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

  it("uses the provider-qualified current model after a switch for tree revision launch", async () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const task = crewStore.createTask(cwd, "Revise tree with current model");
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
    overlay.handleInput("P");
    overlay.handleInput("\r");

    await vi.waitFor(() => {
      expect(executeReviseTree).toHaveBeenCalledWith(cwd, task.id, undefined, "Lead", "anthropic/claude-opus-4-6");
    });
    expect(executeReviseTree).not.toHaveBeenCalledWith(cwd, task.id, undefined, "Lead", "stale-provider/stale-model");
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

  it("does not dispatch when planning completes during repeated renders", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const task = crewStore.createTask(cwd, "Await explicit start");
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
    );
    clearPlanningState(cwd);

    for (let i = 0; i < 3; i++) overlay.render(120);

    expect(spawnWorkersForReadyTasks).not.toHaveBeenCalled();
    expect(crewStore.getTask(cwd, task.id)?.status).toBe("todo");
    overlay.dispose();
  });

  it("does not refill workers when in-progress work completes during repeated renders", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    const completed = crewStore.createTask(cwd, "Completed work");
    const task = crewStore.createTask(cwd, "Await explicit refill");
    crewStore.updateTask(cwd, completed.id, { status: "in_progress", assigned_to: "WorkerOne" });
    vi.mocked(spawnWorkersForReadyTasks).mockReturnValue({ assigned: 0, firstWorkerName: null, mutated: false });
    const overlay = new MessengerOverlay(
      { requestRender: vi.fn() } as any,
      theme,
      createState(cwd),
      { base: cwd, registry: `${cwd}/registry`, inbox: `${cwd}/inbox` } as Dirs,
      () => {},
      {},
      cwd,
    );
    overlay.render(120);
    crewStore.updateTask(cwd, completed.id, { status: "done", assigned_to: undefined });

    for (let i = 0; i < 3; i++) overlay.render(120);

    expect(spawnWorkersForReadyTasks).not.toHaveBeenCalled();
    expect(crewStore.getTask(cwd, task.id)?.status).toBe("todo");
    overlay.dispose();
  });
});

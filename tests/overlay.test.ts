import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../lib.ts";
import * as crewStore from "../crew/store.ts";
import { autonomousState, startPlanningRun, clearPlanningState } from "../crew/state.ts";
import { createTempCrewDirs } from "./helpers/temp-dirs.ts";

vi.mock("../crew/spawn.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../crew/spawn.ts")>();
  return { ...actual, spawnWorkersForReadyTasks: vi.fn() };
});

import { MessengerOverlay } from "../overlay.ts";
import { spawnWorkersForReadyTasks } from "../crew/spawn.ts";

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
    model: "openai-codex/gpt-5.6-terra",
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

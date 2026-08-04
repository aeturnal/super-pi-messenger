import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../lib.ts";
import * as crewStore from "../crew/store.ts";
import { startPlanningRun, clearPlanningState } from "../crew/state.ts";
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
});

describe("MessengerOverlay task snapshots", () => {
  it("reloads tasks after auto-spawn before rendering the completed planning frame", () => {
    const { cwd } = createTempCrewDirs();
    crewStore.createPlan(cwd, "docs/PRD.md");
    crewStore.createTask(cwd, "Implement snapshot reload");
    const task = crewStore.getTasks(cwd)[0]!;

    vi.mocked(spawnWorkersForReadyTasks).mockImplementation(() => {
      crewStore.updateTask(cwd, task.id, { status: "in_progress", assigned_to: "WorkerOne" });
      return { assigned: 1, firstWorkerName: "WorkerOne" };
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

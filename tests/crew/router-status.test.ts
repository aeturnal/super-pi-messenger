import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessengerState, Dirs } from "../../lib.ts";
import { executeCrewAction } from "../../crew/index.ts";
import * as store from "../../crew/store.ts";
import { registerWorker, unregisterWorker } from "../../crew/registry.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";

function createTestState(agentName: string): MessengerState {
  return {
    agentName,
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
    model: "test-model",
    cwd: process.cwd(),
    gitBranch: undefined,
    spec: undefined,
    scopeToFolder: false,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
  };
}

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, ".pi", "messenger");
  const registry = path.join(base, "registry");
  const inbox = path.join(base, "inbox");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  return { base, registry, inbox };
}

describe("crew action router status behavior", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes action=status to messenger status (not crew status)", async () => {
    const { cwd } = createTempCrewDirs();
    const state = createTestState("AgentOne");
    const dirs = createDirs(cwd);
    const ctx = createMockContext(cwd);

    const response = await executeCrewAction(
      "status",
      {},
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {},
    );

    const text = response.content[0].text;
    expect(text).toContain("You: AgentOne");
    expect(text).not.toContain("# Crew Status");
  });

  it("routes action=crew.status to crew status handler", async () => {
    const { cwd } = createTempCrewDirs();
    const state = createTestState("AgentOne");
    const dirs = createDirs(cwd);
    const ctx = createMockContext(cwd);

    const response = await executeCrewAction(
      "crew.status",
      {},
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      vi.fn(),
    );

    const text = response.content[0].text;
    expect(text).toContain("# Crew Status");
  });

  it.each([
    ["planner", { PI_CREW_ROLE: "planner" }],
    ["reviewer", { PI_CREW_ROLE: "reviewer" }],
    ["analyst", { PI_CREW_ROLE: "analyst" }],
    ["worker", { PI_CREW_ROLE: "worker", PI_CREW_WORKER: "1" }],
    ["lobby", { PI_CREW_ROLE: "worker", PI_CREW_WORKER: "1", PI_LOBBY_ID: "lobby-1" }],
  ] as const)("denies task approval and rejection from a %s child marker", async (_kind, env) => {
    const { cwd } = createTempCrewDirs();
    const state = createTestState("CrewChild");
    const dirs = createDirs(cwd);
    const task = store.createTask(cwd, "Gated task", "", [], {
      approval: { required: true, status: "pending" },
    });
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    const approval = await executeCrewAction(
      "task.approve",
      { id: task.id },
      state,
      dirs,
      createMockContext(cwd),
      () => {},
      () => {},
      vi.fn(),
    );
    const rejection = await executeCrewAction(
      "task.reject",
      { id: task.id, reason: "self-review" },
      state,
      dirs,
      createMockContext(cwd),
      () => {},
      () => {},
      vi.fn(),
    );

    expect(approval.details.error).toBe("controller_only");
    expect(rejection.details.error).toBe("controller_only");
    expect(store.getTask(cwd, task.id)?.approval?.status).toBe("pending");
  });

  it.each([
    ["planner", { PI_CREW_ROLE: "planner" }],
    ["reviewer", { PI_CREW_ROLE: "reviewer" }],
    ["analyst", { PI_CREW_ROLE: "analyst" }],
    ["worker", { PI_CREW_ROLE: "worker", PI_CREW_WORKER: "1" }],
    ["lobby", { PI_CREW_ROLE: "worker", PI_CREW_WORKER: "1", PI_LOBBY_ID: "lobby-1" }],
  ] as const)("allows only the safe action matrix for a %s child marker", async (_kind, env) => {
    const allowed = [
      "status", "list", "whois", "feed", "send", "broadcast",
      "reserve", "release", "task.show", "task.list", "task.ready",
      "task.progress", "task.done", "crew.status", "crew.agents",
    ];
    const denied = [
      "plan", "plan.cancel", "work", "work.stop", "review", "sync",
      "team.setup", "team.profile.use", "team.charter.update", "team.memory.note",
      "task.create", "task.split", "task.start", "task.block", "task.unblock",
      "task.reset", "task.delete", "task.approve", "task.reject",
      "task.revise", "task.revise-tree", "future.action",
    ];
    const { cwd } = createTempCrewDirs();
    const state = createTestState("CrewChild");
    const dirs = createDirs(cwd);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    for (const action of allowed) {
      const response = await executeCrewAction(
        action,
        {},
        state,
        dirs,
        createMockContext(cwd),
        () => {},
        () => {},
        vi.fn(),
      );
      expect(response.details.error, action).not.toBe("controller_only");
    }

    for (const action of denied) {
      const response = await executeCrewAction(
        action,
        {},
        state,
        dirs,
        createMockContext(cwd),
        () => {},
        () => {},
        vi.fn(),
      );
      expect(response.details.error, action).toBe("controller_only");
    }
  });

  it("rejects task.reset through the pi_messenger route while its worker is active", async () => {
    const { cwd } = createTempCrewDirs();
    const state = createTestState("AgentOne");
    const dirs = createDirs(cwd);
    const task = store.createTask(cwd, "Active task", "");
    store.startTask(cwd, task.id, "WorkerOne");
    registerWorker({
      type: "worker",
      cwd,
      taskId: task.id,
      name: "WorkerOne",
      proc: { exitCode: null, killed: false, kill: vi.fn() } as never,
    });

    try {
      const response = await executeCrewAction(
        "task.reset",
        { id: task.id },
        state,
        dirs,
        createMockContext(cwd),
        () => {},
        () => {},
        vi.fn(),
      );

      expect(response.details.error).toBe("active_worker");
      expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");
    } finally {
      unregisterWorker(cwd, task.id);
    }
  });
});

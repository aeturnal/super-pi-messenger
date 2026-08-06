import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { createProgress } from "../../crew/utils/progress.ts";
import { createMockContext } from "../helpers/mock-context.ts";

vi.mock("../../crew/agents.ts", () => ({
  spawnAgents: vi.fn(),
}));

describe("executeReviseTree", () => {
  let executeReviseTree: typeof import("../../crew/handlers/revise.ts").executeReviseTree;
  let spawnAgents: ReturnType<typeof vi.fn>;
  let store: typeof import("../../crew/store.ts");
  let state: typeof import("../../crew/state.ts");
  let liveProgress: typeof import("../../crew/live-progress.ts");
  let registry: typeof import("../../crew/registry.ts");
  let taskHandler: typeof import("../../crew/handlers/task.ts");
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../crew/handlers/revise.ts");
    executeReviseTree = mod.executeReviseTree;
    store = await import("../../crew/store.ts");
    state = await import("../../crew/state.ts");
    liveProgress = await import("../../crew/live-progress.ts");
    registry = await import("../../crew/registry.ts");
    taskHandler = await import("../../crew/handlers/task.ts");
    const agents = await import("../../crew/agents.ts");
    spawnAgents = agents.spawnAgents as ReturnType<typeof vi.fn>;

    const dirs = createTempCrewDirs();
    tmpDir = dirs.cwd;
    store.createPlan(tmpDir, "docs/PRD.md");
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "PRD.md"), "# PRD");
  });

  afterEach(() => {
    state.autonomousState.active = false;
    state.autonomousState.cwd = null;
    if (state.planningState.cwd) state.clearPlanningState(state.planningState.cwd);
  });

  it("rejects when __reviser__ already running", async () => {
    const t1 = store.createTask(tmpDir, "Root task");
    liveProgress.updateLiveWorker(tmpDir, "__reviser__", {
      taskId: "__reviser__", agent: "p", name: "R",
      progress: createProgress("p"),
      startedAt: Date.now(),
    });
    const r = await executeReviseTree(tmpDir, t1.id, undefined, "agent");
    expect(r.success).toBe(false);
    expect(r.message).toContain("already running");
    liveProgress.removeLiveWorker(tmpDir, "__reviser__");
  });

  it("rejects during planning", async () => {
    const t1 = store.createTask(tmpDir, "Root");
    state.startPlanningRun(tmpDir, 3);
    const r = await executeReviseTree(tmpDir, t1.id, undefined, "agent");
    expect(r.success).toBe(false);
    expect(r.message).toContain("planning");
    state.clearPlanningState(tmpDir);
  });

  it("rejects during autonomous work", async () => {
    const t1 = store.createTask(tmpDir, "Root");
    state.autonomousState.active = true;
    state.autonomousState.cwd = tmpDir;
    const r = await executeReviseTree(tmpDir, t1.id, undefined, "agent");
    expect(r.success).toBe(false);
    expect(r.message).toContain("autonomous");
  });

  it("rejects tree revision without changing the subtree when a descendant has an active worker", async () => {
    const t1 = store.createTask(tmpDir, "Root", "root spec");
    const t2 = store.createTask(tmpDir, "Child", "child spec", [t1.id]);
    store.startTask(tmpDir, t2.id, "WorkerA");
    const rootBefore = store.getTask(tmpDir, t1.id);
    const before = store.getTask(tmpDir, t2.id);
    registry.registerWorker({
      type: "worker",
      cwd: tmpDir,
      taskId: t2.id,
      name: "WorkerA",
      proc: { exitCode: null, killed: false } as any,
    });

    try {
      expect(await taskHandler.execute(
        "revise-tree",
        { id: t1.id, prompt: "change it" },
        { agentName: "agent" } as any,
        createMockContext(tmpDir),
      )).toMatchObject({ details: { error: "active_worker" } });
      expect(store.getTask(tmpDir, t1.id)).toEqual(rootBefore);
      expect(store.getTask(tmpDir, t2.id)).toEqual(before);
    } finally {
      registry.unregisterWorker(tmpDir, t2.id);
    }
  });

  it("revises subtree: updates specs and resets non-done tasks", async () => {
    const t1 = store.createTask(tmpDir, "Root", "root spec");
    const t2 = store.createTask(tmpDir, "Child", "child spec", [t1.id]);
    const t3 = store.createTask(tmpDir, "Grandchild", "gc spec", [t2.id]);
    store.startTask(tmpDir, t1.id, "w");
    store.completeTask(tmpDir, t1.id, "done");

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"id": "${t2.id}", "title": "Updated Child", "spec": "new child spec", "dependsOn": ["${t1.id}"]},
  {"id": "${t3.id}", "title": "Updated GC", "spec": "new gc spec", "dependsOn": ["${t2.id}"]}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const r = await executeReviseTree(tmpDir, t1.id, "improve", "agent");
    expect(r.success).toBe(true);
    expect(r.message).toContain("2 dependents");

    expect(store.getTask(tmpDir, t2.id)?.title).toBe("Updated Child");
    expect(store.getTask(tmpDir, t2.id)?.status).toBe("todo");
    expect(store.getTaskSpec(tmpDir, t2.id)).toContain("new child spec");

    expect(store.getTask(tmpDir, t3.id)?.title).toBe("Updated GC");
    expect(store.getTask(tmpDir, t3.id)?.status).toBe("todo");
  });

  it.each(["rejected", "pending", "approved"] as const)("creates a fresh pending gate from a %s gated source", async (status) => {
    const source = store.createTask(tmpDir, "Migration", "spec", [], {
      role: "worker",
      risk_labels: ["migration"],
      approval: { required: true, status },
    });

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"title": "Replacement", "spec": "replacement spec", "dependsOn": []}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const r = await executeReviseTree(tmpDir, source.id, undefined, "agent");
    expect(r.success).toBe(true);

    const created = store.getTasks(tmpDir).find(task => task.title === "Replacement");
    expect(created).toMatchObject({
      role: "worker",
      risk_labels: ["migration"],
      approval: { required: true, status: "pending" },
    });
  });

  it.each(["rejected", "pending", "approved"] as const)("requires fresh pending approval for every replacement when an ungated root has a %s gated descendant", async (status) => {
    const root = store.createTask(tmpDir, "Root", "root spec", [], {
      role: "scout",
      risk_labels: ["research"],
    });
    store.createTask(tmpDir, "Gated child", "child spec", [root.id], {
      role: "worker",
      risk_labels: ["migration"],
      approval: { required: true, status },
    });

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"title": "Replacement one", "spec": "replacement one spec", "dependsOn": []},
  {"title": "Replacement two", "spec": "replacement two spec", "dependsOn": []}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const revised = await executeReviseTree(tmpDir, root.id, undefined, "agent");
    expect(revised.success).toBe(true);

    const replacements = store.getTasks(tmpDir).filter(task => task.title.startsWith("Replacement"));
    expect(replacements).toHaveLength(2);
    for (const replacement of replacements) {
      expect(replacement).toMatchObject({
        role: "scout",
        risk_labels: ["research"],
        approval: { required: true, status: "pending" },
      });
      const start = await taskHandler.execute("start", { id: replacement.id }, { agentName: "Worker" } as any, createMockContext(tmpDir));
      expect(start.details.error).toBe("needs_approval");
    }
  });

  it("keeps the root role and risk classification when no subtree task is gated", async () => {
    const root = store.createTask(tmpDir, "Root", "root spec", [], {
      role: "scout",
      risk_labels: ["research"],
    });
    store.createTask(tmpDir, "Child", "child spec", [root.id]);

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"title": "Replacement", "spec": "replacement spec", "dependsOn": []}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const revised = await executeReviseTree(tmpDir, root.id, undefined, "agent");
    expect(revised.success).toBe(true);

    expect(store.getTasks(tmpDir).find(task => task.title === "Replacement")).toMatchObject({
      role: "scout",
      risk_labels: ["research"],
      approval: undefined,
    });
  });

  it("creates new tasks from entries without id", async () => {
    const t1 = store.createTask(tmpDir, "Root", "spec");
    const t2 = store.createTask(tmpDir, "Child", "spec", [t1.id]);

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"id": "${t2.id}", "title": "Child", "spec": "updated child", "dependsOn": ["${t1.id}"]},
  {"title": "New Task", "spec": "brand new spec", "dependsOn": ["${t2.id}"]}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const r = await executeReviseTree(tmpDir, t1.id, undefined, "agent");
    expect(r.success).toBe(true);

    const allTasks = store.getTasks(tmpDir);
    const newTask = allTasks.find(t => t.title === "New Task");
    expect(newTask).toBeDefined();
    expect(store.getTaskSpec(tmpDir, newTask!.id)).toContain("brand new spec");
  });

  it("rejects if returned ID is outside subtree", async () => {
    const t1 = store.createTask(tmpDir, "Root", "spec");
    const t2 = store.createTask(tmpDir, "Child", "spec", [t1.id]);
    const t_outside = store.createTask(tmpDir, "Outside", "spec");

    spawnAgents.mockResolvedValue([{
      exitCode: 0,
      output: `\`\`\`tasks-json
[
  {"id": "${t_outside.id}", "title": "Hijack", "spec": "bad", "dependsOn": []}
]
\`\`\``,
      error: null,
      progress: createProgress("crew-planner"),
    }]);

    const r = await executeReviseTree(tmpDir, t1.id, undefined, "agent");
    expect(r.success).toBe(false);
    expect(r.message).toContain("outside the subtree");
  });
});

describe("getTransitiveDependents", () => {
  let store: typeof import("../../crew/store.ts");
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    store = await import("../../crew/store.ts");
    const dirs = createTempCrewDirs();
    tmpDir = dirs.cwd;
    store.createPlan(tmpDir, "PRD.md");
  });

  it("returns linear chain dependents", () => {
    const t1 = store.createTask(tmpDir, "A");
    const t2 = store.createTask(tmpDir, "B", undefined, [t1.id]);
    const t3 = store.createTask(tmpDir, "C", undefined, [t2.id]);

    const deps = store.getTransitiveDependents(tmpDir, t1.id);
    expect(deps.map(d => d.id).sort()).toEqual([t2.id, t3.id].sort());
  });

  it("returns diamond dependency dependents", () => {
    const t1 = store.createTask(tmpDir, "Root");
    const t2 = store.createTask(tmpDir, "Left", undefined, [t1.id]);
    const t3 = store.createTask(tmpDir, "Right", undefined, [t1.id]);
    const t4 = store.createTask(tmpDir, "Merge", undefined, [t2.id, t3.id]);

    const deps = store.getTransitiveDependents(tmpDir, t1.id);
    expect(deps.map(d => d.id).sort()).toEqual([t2.id, t3.id, t4.id].sort());
  });

  it("returns empty for isolated task", () => {
    store.createTask(tmpDir, "A");
    const t2 = store.createTask(tmpDir, "B");
    const deps = store.getTransitiveDependents(tmpDir, t2.id);
    expect(deps).toEqual([]);
  });
});

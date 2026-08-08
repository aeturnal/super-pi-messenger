import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessengerState } from "../../lib.ts";
import * as taskHandler from "../../crew/handlers/task.ts";
import * as store from "../../crew/store.ts";
import { executeTaskAction } from "../../crew/task-actions.ts";
import { hasActiveWorker, registerWorker, unregisterWorker } from "../../crew/registry.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

function createState(agentName: string): MessengerState {
  return { agentName } as MessengerState;
}

async function callAs(cwd: string, agentName: string, op: "progress" | "done" | "block", id: string) {
  const params = op === "progress"
    ? { id, message: "Still working" }
    : op === "done"
      ? { id, summary: "Finished" }
      : { id, reason: "Waiting on API" };
  return taskHandler.execute(op, params, createState(agentName), createMockContext(cwd));
}

function writeCrewDependenciesConfig(cwd: string, dependencies: "advisory" | "strict"): void {
  const configPath = path.join(cwd, ".pi", "messenger", "crew", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ dependencies }, null, 2));
}

describe("crew/task-actions", () => {
  it("starts a todo task and assigns it", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Implement auth", "Desc");

    const result = executeTaskAction(cwd, "start", task.id, "AgentA");

    expect(result.success).toBe(true);
    expect(result.task?.status).toBe("in_progress");
    expect(result.task?.assigned_to).toBe("AgentA");
  });

  it("returns success when agent is already assigned to in_progress task", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Implement auth", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "start", task.id, "AgentA");

    expect(result.success).toBe(true);
    expect(result.task?.status).toBe("in_progress");
    expect(result.task?.assigned_to).toBe("AgentA");
  });

  it("rejects start when task is in_progress but assigned to different agent", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Implement auth", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "start", task.id, "AgentB");

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_status");
  });

  it("rejects starting when dependencies are not done", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    writeCrewDependenciesConfig(cwd, "strict");
    const dep = store.createTask(cwd, "Dependency", "Desc");
    const task = store.createTask(cwd, "Main", "Desc", [dep.id]);

    const result = executeTaskAction(cwd, "start", task.id, "AgentA");

    expect(result.success).toBe(false);
    expect(result.error).toBe("unmet_dependencies");
    expect(result.unmetDependencies).toEqual([dep.id]);
  });

  it("allows starting when dependencies are not done in advisory mode", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    writeCrewDependenciesConfig(cwd, "advisory");
    const dep = store.createTask(cwd, "Dependency", "Desc");
    const task = store.createTask(cwd, "Main", "Desc", [dep.id]);

    const result = executeTaskAction(cwd, "start", task.id, "AgentA");

    expect(result.success).toBe(true);
    expect(result.task?.status).toBe("in_progress");
    expect(result.error).toBeUndefined();
  });

  it("rejects starting milestones", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Milestone", "Desc");
    store.updateTask(cwd, task.id, { milestone: true });

    const result = executeTaskAction(cwd, "start", task.id, "AgentA");

    expect(result.success).toBe(false);
    expect(result.error).toBe("milestone_not_startable");
  });

  it("blocks and unblocks an in-progress task", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const blocked = executeTaskAction(cwd, "block", task.id, "AgentA", "Waiting on API");
    expect(blocked.success).toBe(true);
    expect(store.getTask(cwd, task.id)?.status).toBe("blocked");

    const unblocked = executeTaskAction(cwd, "unblock", task.id, "AgentA");
    expect(unblocked.success).toBe(true);
    expect(store.getTask(cwd, task.id)?.status).toBe("todo");
  });

  it("rejects split without changing a task that has an active worker", async () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "WorkerA");
    const before = store.getTask(cwd, task.id);
    registerWorker({
      type: "worker",
      cwd,
      taskId: task.id,
      name: "WorkerA",
      proc: { exitCode: null, killed: false } as any,
    });

    try {
      expect(await taskHandler.execute(
        "split",
        { id: task.id, subtasks: [{ title: "First" }, { title: "Second" }] },
        createState("Controller"),
        createMockContext(cwd),
      )).toMatchObject({ details: { error: "active_worker" } });
      expect(store.getTask(cwd, task.id)).toEqual(before);
    } finally {
      unregisterWorker(cwd, task.id);
    }
  });

  it("rejects reset without changing a task that has an active worker", async () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "WorkerA");
    const before = store.getTask(cwd, task.id);
    registerWorker({
      type: "worker",
      cwd,
      taskId: task.id,
      name: "WorkerA",
      proc: { exitCode: null, killed: false } as any,
    });

    try {
      expect(await taskHandler.execute(
        "reset",
        { id: task.id },
        createState("Controller"),
        createMockContext(cwd),
      )).toMatchObject({ details: { error: "active_worker" } });
      expect(store.getTask(cwd, task.id)).toEqual(before);
    } finally {
      unregisterWorker(cwd, task.id);
    }
  });

  it("prevents deleting a todo task with a live registered worker", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    registerWorker({
      type: "worker",
      cwd,
      taskId: task.id,
      name: "AgentA",
      proc: { exitCode: null, killed: false } as any,
    });

    try {
      const result = executeTaskAction(cwd, "delete", task.id, "AgentA", undefined, {
        isWorkerActive: workerTaskId => hasActiveWorker(cwd, workerTaskId),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("active_worker");
      expect(store.getTask(cwd, task.id)).not.toBeNull();
    } finally {
      unregisterWorker(cwd, task.id);
    }
  });

  it("allows deleting a todo task with a dead registered worker", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    registerWorker({
      type: "worker",
      cwd,
      taskId: task.id,
      name: "AgentA",
      proc: { exitCode: 1, killed: false } as any,
    });

    try {
      const result = executeTaskAction(cwd, "delete", task.id, "AgentA", undefined, {
        isWorkerActive: workerTaskId => hasActiveWorker(cwd, workerTaskId),
      });

      expect(result.success).toBe(true);
      expect(store.getTask(cwd, task.id)).toBeNull();
    } finally {
      unregisterWorker(cwd, task.id);
    }
  });

  it("prevents resetting active worker tasks", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "reset", task.id, "AgentA", undefined, {
      isWorkerActive: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("active_worker");
    expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");
  });

  it("prevents cascade-reset when a dependent has an active worker", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const parent = store.createTask(cwd, "Parent", "Desc");
    const child = store.createTask(cwd, "Child", "Desc", [parent.id]);
    store.startTask(cwd, child.id, "AgentA");

    const result = executeTaskAction(cwd, "cascade-reset", parent.id, "AgentA", undefined, {
      isWorkerActive: taskId => taskId === child.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("active_worker");
    expect(store.getTask(cwd, child.id)?.status).toBe("in_progress");
  });

  it("deletes non-active tasks", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");

    const result = executeTaskAction(cwd, "delete", task.id, "AgentA", undefined, {
      isWorkerActive: () => false,
    });

    expect(result.success).toBe(true);
    expect(store.getTask(cwd, task.id)).toBeNull();
  });

  it("stops an in-progress task with an active worker", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "stop", task.id, "AgentA", undefined, {
      isWorkerActive: () => true,
    });

    expect(result.success).toBe(true);
    const updated = store.getTask(cwd, task.id);
    expect(updated?.status).toBe("todo");
    expect(updated?.assigned_to).toBeUndefined();
    const progress = store.getTaskProgress(cwd, task.id);
    expect(progress).toContain("Worker stopped by user");
  });

  it("rejects stop when task is not in_progress", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");

    const result = executeTaskAction(cwd, "stop", task.id, "AgentA", undefined, {
      isWorkerActive: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_status");
  });

  it("stop without active worker resets task to todo", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "stop", task.id, "AgentA", undefined, {
      isWorkerActive: () => false,
    });

    expect(result.success).toBe(true);
    const updated = store.getTask(cwd, task.id);
    expect(updated?.status).toBe("todo");
    expect(updated?.assigned_to).toBeUndefined();
  });

  describe("assigned task ownership", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("allows only the assigned child to complete an in-progress task", async () => {
      const { cwd } = createTempCrewDirs();
      store.createPlan(cwd, "docs/PRD.md");
      const task = store.createTask(cwd, "Task", "Desc");
      store.startTask(cwd, task.id, "WorkerA");
      vi.stubEnv("PI_CREW_WORKER", "1");

      expect(await callAs(cwd, "WorkerB", "done", task.id)).toMatchObject({
        details: { error: "not_owner" },
      });
      expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");

      expect(await callAs(cwd, "WorkerA", "done", task.id)).toMatchObject({
        details: { task: { status: "done" } },
      });
    });

    it("allows only the assigned child to log task progress", async () => {
      const { cwd } = createTempCrewDirs();
      store.createPlan(cwd, "docs/PRD.md");
      const task = store.createTask(cwd, "Task", "Desc");
      store.startTask(cwd, task.id, "WorkerA");
      vi.stubEnv("PI_CREW_WORKER", "1");

      expect(await callAs(cwd, "WorkerB", "progress", task.id)).toMatchObject({
        details: { error: "not_owner" },
      });
      expect(store.getTaskProgress(cwd, task.id)).toBeNull();
    });

    it("rejects an unassigned child blocking an in-progress task", async () => {
      const { cwd } = createTempCrewDirs();
      store.createPlan(cwd, "docs/PRD.md");
      const task = store.createTask(cwd, "Task", "Desc");
      store.startTask(cwd, task.id, "WorkerA");
      vi.stubEnv("PI_CREW_WORKER", "1");

      expect(await callAs(cwd, "WorkerB", "block", task.id)).toMatchObject({
        details: { error: "not_owner" },
      });
      expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");
    });

    it("allows the assigned child to block its in-progress task", async () => {
      const { cwd } = createTempCrewDirs();
      store.createPlan(cwd, "docs/PRD.md");
      const task = store.createTask(cwd, "Task", "Desc");
      store.startTask(cwd, task.id, "WorkerA");
      vi.stubEnv("PI_CREW_WORKER", "1");

      expect(await callAs(cwd, "WorkerA", "block", task.id)).toMatchObject({
        details: { task: { status: "blocked" } },
      });
    });

    it("allows the controller to recover an assigned task", async () => {
      const { cwd } = createTempCrewDirs();
      store.createPlan(cwd, "docs/PRD.md");
      const task = store.createTask(cwd, "Task", "Desc");
      store.startTask(cwd, task.id, "WorkerA");
      vi.stubEnv("PI_CREW_WORKER", "");
      vi.stubEnv("PI_CREW_ROLE", "");
      vi.stubEnv("PI_LOBBY_ID", "");

      expect(await callAs(cwd, "Controller", "done", task.id)).toMatchObject({
        details: { task: { status: "done" } },
      });
    });
  });
});

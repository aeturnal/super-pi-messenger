import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MessengerState } from "../../lib.js";
import * as store from "../../crew/store.js";
import { executeTaskAction } from "../../crew/task-actions.js";
import { execute as executeTaskHandler } from "../../crew/handlers/task.js";
import { createAttempt, writeSchedulerRecord } from "../../crew/execution/store.js";
import { persistLobbyAttemptIdentity } from "../../crew/execution/lobby-assignment.js";
import type { AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const runId = "11111111-1111-4111-8111-111111111111";
const attemptA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function seedExecutionOwnedTask(cwd: string) {
  store.createPlan(cwd, "docs/PRD.md");
  const task = store.createTask(cwd, "Attempt owned", "Desc");
  store.updateTask(cwd, task.id, {
    status: "in_progress",
    assigned_to: "WorkerA",
    current_attempt_id: attemptA,
    attempt_count: 1,
  });
  const attempt: AttemptRecord = {
    version: 1,
    attemptId: attemptA,
    runId,
    taskId: task.id,
    controllerId: "controller-a",
    leaseEpoch: 1,
    workerName: "WorkerA",
    pid: 123,
    startedAt: "2026-07-28T12:00:00.000Z",
    state: "running",
    attemptCharged: true,
    rollbackApplied: false,
    cancellation: null,
  };
  createAttempt(cwd, attempt);
  const scheduler: SchedulerRecord = {
    version: 1,
    runId,
    controllerId: "controller-a",
    leaseEpoch: 1,
    mode: "continuous",
    waveSnapshotTaskIds: [],
    waveTargetState: {},
    desiredConcurrencyOverride: null,
    activeAttemptIds: [attemptA],
    cancellationIntent: null,
  };
  writeSchedulerRecord(cwd, scheduler);
  return task;
}

function handlerState(): MessengerState {
  return { agentName: "WorkerA" } as MessengerState;
}

function handlerContext(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("prevents deleting active in-progress worker tasks", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Task", "Desc");
    store.startTask(cwd, task.id, "AgentA");

    const result = executeTaskAction(cwd, "delete", task.id, "AgentA", undefined, {
      isWorkerActive: () => true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("active_worker");
    expect(store.getTask(cwd, task.id)).not.toBeNull();
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

  it("binds task.done to the ordinary worker attempt environment and requests reconciliation", async () => {
    const { cwd } = createTempCrewDirs();
    const task = seedExecutionOwnedTask(cwd);
    writeCrewDependenciesConfig(cwd, "strict");
    const configPath = path.join(cwd, ".pi", "messenger", "crew", "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ dependencies: "strict", review: { enabled: false } }));
    vi.stubEnv("PI_CREW_ATTEMPT_ID", attemptA);
    vi.stubEnv("PI_LOBBY_ID", "");
    const reconciliations: Array<{ reason: string; facts: unknown }> = [];

    const response = await executeTaskHandler(
      "done",
      { id: task.id, summary: "Done from owned child" },
      handlerState(),
      handlerContext(cwd),
      { requestReconcile: (reason: string, facts: unknown) => reconciliations.push({ reason, facts }) },
    );

    expect(response.details).toMatchObject({ mode: "task.done", task: { status: "done" } });
    expect(store.getTask(cwd, task.id)?.completion_attempt_id).toBe(attemptA);
    expect(reconciliations).toEqual([{ reason: "durable_completion", facts: undefined }]);
  });

  it("uses trusted warm-lobby identity instead of a model-supplied attempt", async () => {
    const { cwd } = createTempCrewDirs();
    const task = seedExecutionOwnedTask(cwd);
    const configPath = path.join(cwd, ".pi", "messenger", "crew", "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ review: { enabled: false } }));
    persistLobbyAttemptIdentity(cwd, {
      version: 1,
      lobbyId: "lobby-a",
      taskId: task.id,
      attemptId: attemptA,
      runId,
      controllerId: "controller-a",
    });
    vi.stubEnv("PI_LOBBY_ID", "lobby-a");
    vi.stubEnv("PI_CREW_ATTEMPT_ID", attemptB);

    const response = await executeTaskHandler(
      "done",
      { id: task.id, summary: "Done from lobby", attemptId: attemptB },
      handlerState(),
      handlerContext(cwd),
    );

    expect(response.details).toMatchObject({ mode: "task.done", task: { status: "done" } });
    expect(store.getTask(cwd, task.id)?.completion_attempt_id).toBe(attemptA);
  });

  it("owns the review-pending reconciliation fact at task.done", async () => {
    const { cwd } = createTempCrewDirs();
    const task = seedExecutionOwnedTask(cwd);
    vi.stubEnv("PI_CREW_ATTEMPT_ID", attemptA);
    vi.stubEnv("PI_LOBBY_ID", "");
    const reconciliations: Array<{ reason: string; facts: unknown }> = [];

    await executeTaskHandler(
      "done",
      { id: task.id, summary: "Awaiting review" },
      handlerState(),
      handlerContext(cwd),
      { requestReconcile: (reason: string, facts: unknown) => reconciliations.push({ reason, facts }) },
    );

    expect(store.getTask(cwd, task.id)?.status).toBe("review_pending");
    expect(reconciliations).toEqual([{
      reason: "durable_completion",
      facts: {
        taskOutcomes: [{ name: "task.review_pending", taskId: task.id, attemptId: attemptA }],
      },
    }]);
  });

  it("keeps legacy completeTask from bypassing execution attempt ownership", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedExecutionOwnedTask(cwd);
    const before = store.getTask(cwd, task.id);

    expect(store.completeTask(cwd, task.id, "Bypass")).toBeNull();
    expect(store.getTask(cwd, task.id)).toEqual(before);
  });
});

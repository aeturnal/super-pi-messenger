import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as taskStore from "../../crew/store.js";
import {
  classifyChildClose,
  persistCancellation,
  signalCancelledAttempts,
} from "../../crew/execution/attempts.js";
import { reconcileChildClose } from "../../crew/spawn.js";
import { appendSchedulerEvent, type SchedulerEvent } from "../../crew/execution/events.js";
import {
  createAttempt,
  readAttempt,
  readSchedulerRecord,
  writeSchedulerRecord,
} from "../../crew/execution/store.js";
import type { AttemptCancellation, AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import type { Task } from "../../crew/types.js";
import { registerWorker } from "../../crew/registry.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const closedAt = "2026-07-28T12:05:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const attemptA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function scheduler(activeAttemptIds: string[]): SchedulerRecord {
  return {
    version: 1, runId, controllerId: "controller-a", leaseEpoch: 1, mode: "paused",
    waveSnapshotTaskIds: [], waveTargetState: {}, desiredConcurrencyOverride: null,
    activeAttemptIds, cancellationIntent: null,
  };
}

function attempt(
  attemptId: string,
  taskId: string,
  cancellation: AttemptCancellation | null = null,
  attemptCharged = true,
): AttemptRecord {
  return {
    version: 1, attemptId, runId, taskId, controllerId: "controller-a", leaseEpoch: 1,
    workerName: `worker-${taskId}`, pid: 123, startedAt: now, state: "running",
    attemptCharged, rollbackApplied: false, cancellation,
  };
}

function taskForClose(completion: "done" | "review_pending" | "different_attempt" | null): Pick<
  Task,
  "status" | "completion_attempt_id" | "legacy_review_state"
> {
  if (completion === "done") {
    return { status: "done", completion_attempt_id: attemptA };
  }
  if (completion === "review_pending") {
    return {
      status: "review_pending",
      legacy_review_state: { version: 1, state: "pending", reviewCount: 0, attemptId: attemptA },
    };
  }
  if (completion === "different_attempt") {
    return { status: "done", completion_attempt_id: attemptB };
  }
  return { status: "in_progress" };
}

const closeCases = [
  { completion: "done", cancellation: null, code: 1, signal: "SIGTERM", result: "completed" },
  { completion: "review_pending", cancellation: null, code: 0, signal: null, result: "review_pending" },
  { completion: null, cancellation: "user_stop", code: 1, signal: null, result: "cancelled" },
  { completion: null, cancellation: "orchestrator_shutdown", code: null, signal: "SIGKILL", result: "cancelled" },
  { completion: null, cancellation: null, code: 0, signal: null, result: "protocol_incomplete" },
  { completion: null, cancellation: null, code: 1, signal: null, result: "worker_crash" },
  { completion: null, cancellation: null, code: null, signal: "SIGTERM", result: "worker_crash" },
  { completion: "different_attempt", cancellation: null, code: 0, signal: null, result: "protocol_incomplete" },
] as const;

describe("child-close precedence", () => {
  it.each(closeCases)(
    "classifies completion=$completion cancellation=$cancellation code=$code signal=$signal as $result",
    ({ completion, cancellation, code, signal, result }) => {
      const persistedCancellation = cancellation === null ? null : {
        kind: cancellation,
        requestedBy: "human",
        requestedAt: now,
      };
      expect(classifyChildClose({
        attemptId: attemptA,
        task: taskForClose(completion),
        cancellation: persistedCancellation,
        exitCode: code,
        signal,
      }).kind).toBe(result);
    },
  );
});

function seedRunningTask(cwd: string, attemptId = attemptA): Task {
  taskStore.createPlan(cwd, "PRD.md");
  const task = taskStore.createTask(cwd, `Task ${attemptId.slice(0, 1)}`);
  taskStore.updateTask(cwd, task.id, {
    status: "in_progress",
    assigned_to: `worker-${task.id}`,
    current_attempt_id: attemptId,
    attempt_count: 1,
  });
  createAttempt(cwd, attempt(attemptId, task.id));
  return taskStore.getTask(cwd, task.id)!;
}

function fakeProcess(pid: number, onKill: () => void): EventEmitter & Record<string, any> {
  const proc = new EventEmitter() as EventEmitter & Record<string, any>;
  proc.pid = pid;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    onKill();
    proc.killed = true;
    return true;
  });
  return proc;
}

describe("durable cancellation", () => {
  it("persists scheduler intent and every attempt cancellation before signaling", () => {
    const { cwd } = createTempCrewDirs();
    const taskA = seedRunningTask(cwd, attemptA);
    const taskB = taskStore.createTask(cwd, "Task B");
    taskStore.updateTask(cwd, taskB.id, {
      status: "in_progress", assigned_to: "worker-b", current_attempt_id: attemptB, attempt_count: 1,
    });
    createAttempt(cwd, attempt(attemptB, taskB.id));
    writeSchedulerRecord(cwd, scheduler([attemptA, attemptB]));

    const assertDurableBeforeSignal = () => {
      expect(readSchedulerRecord(cwd)?.cancellationIntent).toEqual({
        requestedBy: "human", kind: "user_stop", attemptIds: [attemptA, attemptB], requestedAt: now,
      });
      expect(readAttempt(cwd, attemptA)?.cancellation).toMatchObject({ kind: "user_stop", requestedAt: now });
      expect(readAttempt(cwd, attemptB)?.cancellation).toMatchObject({ kind: "user_stop", requestedAt: now });
    };
    registerWorker({
      type: "worker", cwd, taskId: taskA.id, attemptId: attemptA, name: "worker-a",
      proc: fakeProcess(101, assertDurableBeforeSignal) as any,
    });
    registerWorker({
      type: "worker", cwd, taskId: taskB.id, attemptId: attemptB, name: "worker-b",
      proc: fakeProcess(202, assertDurableBeforeSignal) as any,
    });

    persistCancellation({
      cwd, requestedBy: "human", kind: "user_stop", attemptIds: [attemptA, attemptB], requestedAt: now,
    });
    expect(signalCancelledAttempts({ cwd, attemptIds: [attemptA, attemptB] })).toBe(2);
  });

  it("refuses to signal an attempt whose cancellation is not durable", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedRunningTask(cwd);
    writeSchedulerRecord(cwd, scheduler([attemptA]));
    const proc = fakeProcess(101, () => {});
    registerWorker({ type: "worker", cwd, taskId: task.id, attemptId: attemptA, name: "worker-a", proc: proc as any });

    expect(() => signalCancelledAttempts({ cwd, attemptIds: [attemptA] })).toThrow("not durably cancelled");
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("restores an uncharged cancellation without decrementing its attempt count", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    taskStore.createPlan(cwd, "PRD.md");
    const task = taskStore.createTask(cwd, "Uncharged task");
    taskStore.updateTask(cwd, task.id, {
      status: "in_progress", assigned_to: "worker-a", current_attempt_id: attemptA, attempt_count: 4,
    });
    createAttempt(cwd, attempt(attemptA, task.id, null, false));
    writeSchedulerRecord(cwd, scheduler([attemptA]));
    persistCancellation({
      cwd, requestedBy: "human", kind: "user_stop", attemptIds: [attemptA], requestedAt: now,
    });

    expect(reconcileChildClose({ cwd, attemptId: attemptA, exitCode: 1, signal: null, closedAt }).kind)
      .toBe("cancelled");
    expect(taskStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 4 });
    expect(taskStore.getTask(cwd, task.id)?.assigned_to).toBeUndefined();
    expect(taskStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
    expect(taskStore.getTaskProgress(cwd, task.id)).toContain("cancelled by human");
    const events = fs.readFileSync(path.join(crewDir, "scheduler-events.jsonl"), "utf8").trim().split("\n");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0])).toMatchObject({ name: "task.cancelled", attemptId: attemptA });
    expect(readAttempt(cwd, attemptA)?.rollbackApplied).toBe(true);
  });

  it.each(["task", "scheduler", "progress", "event"] as const)(
    "replays cancellation idempotently after a post-%s-effect failure",
    boundary => {
      const { cwd, crewDir } = createTempCrewDirs();
      const task = seedRunningTask(cwd);
      writeSchedulerRecord(cwd, scheduler([attemptA]));
      persistCancellation({
        cwd, requestedBy: "human", kind: "user_stop", attemptIds: [attemptA], requestedAt: now,
      });
      const failure = new Error(`${boundary} effect failed after persistence`);

      expect(() => reconcileChildClose(
        { cwd, attemptId: attemptA, exitCode: 1, signal: null, closedAt },
        {
          updateTask: (targetCwd: string, taskId: string, updates: Partial<Task>) => {
            const result = taskStore.updateTask(targetCwd, taskId, updates);
            if (boundary === "task") throw failure;
            return result;
          },
          writeSchedulerRecord: (targetCwd: string, record: SchedulerRecord) => {
            writeSchedulerRecord(targetCwd, record);
            if (boundary === "scheduler" && !record.activeAttemptIds.includes(attemptA)) throw failure;
          },
          appendTaskProgress: (targetCwd: string, taskId: string, agent: string, message: string) => {
            taskStore.appendTaskProgress(targetCwd, taskId, agent, message);
            if (boundary === "progress") throw failure;
          },
          appendSchedulerEvent: (targetCwd: string, event: SchedulerEvent) => {
            appendSchedulerEvent(targetCwd, event);
            if (boundary === "event" && event.name === "task.cancelled") throw failure;
          },
        },
      )).toThrow(failure.message);
      expect(readAttempt(cwd, attemptA)?.rollbackApplied).toBe(false);

      expect(reconcileChildClose({ cwd, attemptId: attemptA, exitCode: 1, signal: null, closedAt }).kind)
        .toBe("cancelled");
      expect(taskStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
      expect(taskStore.getTask(cwd, task.id)?.assigned_to).toBeUndefined();
      expect(taskStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
      expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
      const progress = taskStore.getTaskProgress(cwd, task.id) ?? "";
      expect(progress.split(`Attempt ${attemptA} cancelled by human`)).toHaveLength(2);
      const events = fs.readFileSync(path.join(crewDir, "scheduler-events.jsonl"), "utf8")
        .trim().split("\n").map(line => JSON.parse(line))
        .filter(event => event.name === "task.cancelled" && event.attemptId === attemptA);
      expect(events).toHaveLength(1);
      expect(readAttempt(cwd, attemptA)?.rollbackApplied).toBe(true);
    },
  );

  it("restores a cancelled task and applies charged rollback once across reload and replay", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    const task = seedRunningTask(cwd);
    writeSchedulerRecord(cwd, scheduler([attemptA]));
    persistCancellation({
      cwd, requestedBy: "human", kind: "user_stop", attemptIds: [attemptA], requestedAt: now,
    });

    const first = reconcileChildClose({ cwd, attemptId: attemptA, exitCode: 1, signal: null, closedAt });
    const afterFirst = taskStore.getTask(cwd, task.id)!;
    const progressAfterFirst = taskStore.getTaskProgress(cwd, task.id);
    const reloadedAttempt = JSON.parse(fs.readFileSync(path.join(crewDir, "attempts", `${attemptA}.json`), "utf8"));

    expect(first.kind).toBe("cancelled");
    expect(afterFirst).toMatchObject({ status: "todo", attempt_count: 0 });
    expect(afterFirst.assigned_to).toBeUndefined();
    expect(afterFirst.current_attempt_id).toBeUndefined();
    expect(progressAfterFirst).toContain("cancelled by human");
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
    expect(reloadedAttempt).toMatchObject({
      state: "closed", exitCode: 1, signal: null, closedAt, rollbackApplied: true,
    });

    const replay = reconcileChildClose({ cwd, attemptId: attemptA, exitCode: 1, signal: null, closedAt });
    expect(replay.kind).toBe("cancelled");
    expect(taskStore.getTask(cwd, task.id)?.attempt_count).toBe(0);
    expect(taskStore.getTaskProgress(cwd, task.id)).toBe(progressAfterFirst);
    const events = fs.readFileSync(path.join(crewDir, "scheduler-events.jsonl"), "utf8").trim().split("\n");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).name).toBe("task.cancelled");
  });
});

describe("non-cancellation close reconciliation", () => {
  it.each([
    { code: 0, signal: null, kind: "protocol_incomplete", blockedCode: "protocol_incomplete" },
    { code: 1, signal: null, kind: "worker_crash", blockedCode: "worker_crash" },
    { code: null, signal: "SIGTERM", kind: "worker_crash", blockedCode: "worker_crash" },
  ] as const)("blocks $kind and never rolls back or retries", ({ code, signal, kind, blockedCode }) => {
    const { cwd } = createTempCrewDirs();
    const task = seedRunningTask(cwd);
    writeSchedulerRecord(cwd, scheduler([attemptA]));

    expect(reconcileChildClose({ cwd, attemptId: attemptA, exitCode: code, signal, closedAt }).kind).toBe(kind);
    expect(taskStore.getTask(cwd, task.id)).toMatchObject({
      status: "blocked", blocked_code: blockedCode, attempt_count: 1,
    });
    expect(taskStore.getTask(cwd, task.id)?.assigned_to).toBeUndefined();
    expect(taskStore.getTask(cwd, task.id)?.current_attempt_id).toBeUndefined();
    expect(readAttempt(cwd, attemptA)?.rollbackApplied).toBe(false);
    expect(readSchedulerRecord(cwd)?.activeAttemptIds).toEqual([]);
  });
});

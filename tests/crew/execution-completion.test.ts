import { describe, expect, it } from "vitest";
import { completeOwnedAttempt, type CompleteOwnedAttemptInput } from "../../crew/execution/completion.js";
import { createAttempt, updateAttempt, writeSchedulerRecord } from "../../crew/execution/store.js";
import type { AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import * as store from "../../crew/store.js";
import type { Task } from "../../crew/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const runId = "11111111-1111-4111-8111-111111111111";
const attemptA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = "2026-07-28T12:00:00.000Z";

function scheduler(activeAttemptIds: string[] = [attemptA]): SchedulerRecord {
  return {
    version: 1,
    runId,
    controllerId: "controller-a",
    leaseEpoch: 1,
    mode: "continuous",
    waveSnapshotTaskIds: [],
    waveTargetState: {},
    desiredConcurrencyOverride: null,
    activeAttemptIds,
    cancellationIntent: null,
  };
}

function attempt(attemptId: string, taskId: string, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    version: 1,
    attemptId,
    runId,
    taskId,
    controllerId: "controller-a",
    leaseEpoch: 1,
    workerName: "worker-a",
    pid: 123,
    startedAt: now,
    state: "running",
    attemptCharged: true,
    rollbackApplied: false,
    cancellation: null,
    ...overrides,
  };
}

function seedOwnedTask(cwd: string): Task {
  store.createPlan(cwd, "PRD.md");
  const task = store.createTask(cwd, "Owned task", "Implement it");
  store.updateTask(cwd, task.id, {
    status: "in_progress",
    assigned_to: "worker-a",
    current_attempt_id: attemptA,
    attempt_count: 1,
  });
  createAttempt(cwd, attempt(attemptA, task.id));
  writeSchedulerRecord(cwd, scheduler());
  return store.getTask(cwd, task.id)!;
}

function input(cwd: string, taskId: string, overrides: Partial<CompleteOwnedAttemptInput> = {}): CompleteOwnedAttemptInput {
  return {
    cwd,
    taskId,
    attemptId: attemptA,
    summary: "Implemented owned completion",
    evidence: { tests: ["npx vitest run"] },
    reviewEnabled: false,
    completedAt: now,
    ...overrides,
  };
}

describe("attempt-scoped completion", () => {
  it("commits the first owned completion and makes a duplicate an idempotent no-op", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedOwnedTask(cwd);

    const first = completeOwnedAttempt(input(cwd, task.id));
    const duplicate = completeOwnedAttempt(input(cwd, task.id, {
      summary: "A duplicate must not replace prior evidence",
      completedAt: "2026-07-28T12:01:00.000Z",
    }));

    expect(first.kind).toBe("committed");
    expect(duplicate.kind).toBe("duplicate");
    if (first.kind !== "rejected" && duplicate.kind !== "rejected") {
      expect(duplicate.task).toEqual(first.task);
      expect(first.task).toMatchObject({
        status: "done",
        completion_attempt_id: attemptA,
        completed_at: now,
        summary: "Implemented owned completion",
      });
    }
    expect(store.getPlan(cwd)?.completed_count).toBe(1);
  });

  it("carries the durable review count into a retry attempt", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedOwnedTask(cwd);
    store.updateTask(cwd, task.id, {
      review_count: 1,
      legacy_review_state: {
        version: 1,
        state: "needs_work",
        reviewCount: 1,
        attemptId: attemptB,
      },
    });

    expect(completeOwnedAttempt(input(cwd, task.id, { reviewEnabled: true }))).toMatchObject({
      kind: "committed",
      task: {
        legacy_review_state: { state: "pending", reviewCount: 1, attemptId: attemptA },
      },
    });
  });

  it("keeps dependencies locked while review is pending and unlocks them only after done", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedOwnedTask(cwd);
    const dependent = store.createTask(cwd, "Dependent", "Wait", [task.id]);

    const completed = completeOwnedAttempt(input(cwd, task.id, { reviewEnabled: true }));

    expect(completed.kind).toBe("committed");
    expect(store.getTask(cwd, task.id)).toMatchObject({
      status: "review_pending",
      completion_attempt_id: attemptA,
      legacy_review_state: {
        version: 1,
        state: "pending",
        reviewCount: 0,
        attemptId: attemptA,
      },
    });
    expect(store.getReadyTasks(cwd).map(candidate => candidate.id)).not.toContain(dependent.id);
    expect(store.getPlan(cwd)?.completed_count).toBe(0);
  });

  it.each([
    ["missing identity", undefined, undefined],
    ["stale identity", attemptB, undefined],
    ["foreign task", attemptA, { taskId: "task-foreign" }],
    ["closed attempt", attemptA, { state: "closed" as const }],
  ] as const)("rejects %s without mutating completion evidence", (_label, suppliedAttemptId, attemptOverrides) => {
    const { cwd } = createTempCrewDirs();
    const task = seedOwnedTask(cwd);
    if (attemptOverrides) {
      updateAttempt(cwd, attemptA, current => ({ ...current, ...attemptOverrides }));
    }
    const before = store.getTask(cwd, task.id);

    const result = completeOwnedAttempt(input(cwd, task.id, { attemptId: suppliedAttemptId }));

    expect(result).toMatchObject({ kind: "rejected" });
    expect(store.getTask(cwd, task.id)).toEqual(before);
    expect(store.getPlan(cwd)?.completed_count).toBe(0);
  });

  it("rejects an attempt no longer owned by the active scheduler without mutation", () => {
    const { cwd } = createTempCrewDirs();
    const task = seedOwnedTask(cwd);
    writeSchedulerRecord(cwd, scheduler([]));
    const before = store.getTask(cwd, task.id);

    expect(completeOwnedAttempt(input(cwd, task.id))).toMatchObject({
      kind: "rejected",
      reason: "unowned_attempt",
    });
    expect(store.getTask(cwd, task.id)).toEqual(before);
  });
});

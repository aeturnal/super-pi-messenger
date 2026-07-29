import { describe, expect, it } from "vitest";
import { selectDispatches, type SelectionInput } from "../../crew/execution/selection.js";
import type { SchedulerRecord } from "../../crew/execution/types.js";
import type { Task } from "../../crew/types.js";

const now = "2026-07-28T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";

function task(
  id: string,
  status: Task["status"],
  attemptCount: number,
  dependsOn: string[] = [],
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    title: id,
    status,
    depends_on: dependsOn,
    created_at: now,
    updated_at: now,
    attempt_count: attemptCount,
    ...overrides,
  };
}

function record(mode: SchedulerRecord["mode"]): SchedulerRecord {
  return {
    version: 1,
    runId,
    controllerId: "controller-a",
    leaseEpoch: 1,
    mode,
    waveSnapshotTaskIds: [],
    waveTargetState: {},
    desiredConcurrencyOverride: null,
    activeAttemptIds: [],
    cancellationIntent: null,
  };
}

function waveRecord(taskIds: string[]): SchedulerRecord {
  return {
    ...record("wave"),
    waveSnapshotTaskIds: taskIds,
    waveTargetState: Object.fromEntries(taskIds.map((taskId) => [taskId, {
      authorized: true,
      retryEligible: true,
      terminal: false,
    }])),
  };
}

function targetedRecord(taskId: string): SchedulerRecord {
  return {
    ...waveRecord([taskId]),
    mode: "targeted",
  };
}

function baseInput(overrides: Partial<SelectionInput> = {}): SelectionInput {
  return {
    scheduler: record("continuous"),
    tasks: [],
    liveAssignedAttemptIds: new Set(),
    reservedTaskIds: new Set(),
    desiredConcurrency: 2,
    maxAttemptsPerTask: 3,
    dependencies: "strict",
    ...overrides,
  };
}

const tasks = [
  task("task-2", "todo", 1),
  task("task-1", "todo", 0),
  task("task-3", "todo", 0, ["task-1"]),
];

describe("selectDispatches", () => {
  it.each([
    ["idle", record("idle"), [], []],
    ["paused", record("paused"), [], []],
    ["wave excludes newly ready IDs", waveRecord(["task-1", "task-2"]), tasks, ["task-1", "task-2"]],
    ["continuous uses current readiness", record("continuous"), tasks, ["task-1", "task-2"]],
    ["targeted consumes exactly one ID", targetedRecord("task-2"), tasks, ["task-2"]],
  ] as const)("%s", (_name, scheduler, inputTasks, expected) => {
    expect(selectDispatches(baseInput({ scheduler, tasks: [...inputTasks] })).taskIds).toEqual(expected);
  });

  it("prioritizes attempt-zero tasks before retries and uses task ID as the stable tie-breaker", () => {
    const inputTasks = [
      task("task-3", "todo", 0),
      task("task-1", "todo", 1),
      task("task-2", "todo", 0),
    ];

    expect(selectDispatches(baseInput({ tasks: inputTasks, desiredConcurrency: 3 })).taskIds)
      .toEqual(["task-2", "task-3", "task-1"]);
  });

  it.each([
    ["review_pending", task("task-1", "review_pending", 1)],
    ["claiming review", task("task-1", "todo", 1, [], {
      legacy_review_state: {
        version: 1,
        state: "claiming",
        reviewCount: 1,
        attemptId: "attempt-1",
      },
    })],
  ])("keeps %s work wave-outstanding", (_name, outstandingTask) => {
    const result = selectDispatches(baseInput({
      scheduler: waveRecord(["task-1"]),
      tasks: [outstandingTask],
      desiredConcurrency: 1,
    }));

    expect(result.taskIds).toEqual([]);
    expect(result.waveDrained).toBe(false);
  });

  it("marks max-attempt and reserved tasks unavailable", () => {
    const result = selectDispatches(baseInput({
      tasks: [task("task-1", "todo", 3), task("task-2", "todo", 0)],
      reservedTaskIds: new Set(["task-2"]),
    }));

    expect(result.taskIds).toEqual([]);
    expect(result.unavailable).toEqual({
      "task-1": "max_attempts",
      "task-2": "reserved",
    });
  });

  it("requires done dependencies in strict mode but treats them as advisory otherwise", () => {
    const inputTasks = [
      task("task-1", "blocked", 0),
      task("task-2", "todo", 0, ["task-1"]),
    ];

    const strict = selectDispatches(baseInput({ tasks: inputTasks, dependencies: "strict" }));
    const advisory = selectDispatches(baseInput({ tasks: inputTasks, dependencies: "advisory" }));

    expect(strict.taskIds).toEqual([]);
    expect(strict.unavailable).toEqual({ "task-2": "dependency_not_done" });
    expect(advisory.taskIds).toEqual(["task-2"]);
  });

  it("counts live assigned attempts as occupied slots without counting idle lobby assignments", () => {
    const inputTasks = [
      task("task-1", "in_progress", 1, [], { current_attempt_id: "attempt-live", assigned_to: "worker-a" }),
      task("task-2", "todo", 0, [], { assigned_to: "idle-lobby-worker" }),
      task("task-3", "todo", 0),
    ];

    const result = selectDispatches(baseInput({
      tasks: inputTasks,
      liveAssignedAttemptIds: new Set(["attempt-live"]),
      desiredConcurrency: 2,
    }));

    expect(result.slots).toBe(1);
    expect(result.taskIds).toEqual(["task-2"]);
  });

  it("selects no extra work when concurrency is reduced below assigned work", () => {
    const result = selectDispatches(baseInput({
      tasks: [
        task("task-1", "in_progress", 1, [], { current_attempt_id: "attempt-1" }),
        task("task-2", "in_progress", 1, [], { current_attempt_id: "attempt-2" }),
        task("task-3", "todo", 0),
      ],
      liveAssignedAttemptIds: new Set(["attempt-1", "attempt-2"]),
      desiredConcurrency: 1,
    }));

    expect(result.slots).toBe(0);
    expect(result.taskIds).toEqual([]);
  });

  it("drains a wave only when every snapshot task is terminal or deterministically unavailable", () => {
    const terminal = selectDispatches(baseInput({
      scheduler: waveRecord(["task-1", "task-2"]),
      tasks: [task("task-1", "done", 1), task("task-2", "blocked", 3)],
    }));
    const unavailable = selectDispatches(baseInput({
      scheduler: waveRecord(["task-1"]),
      tasks: [task("task-1", "todo", 3)],
    }));
    const active = selectDispatches(baseInput({
      scheduler: waveRecord(["task-1"]),
      tasks: [task("task-1", "in_progress", 3, [], { current_attempt_id: "attempt-1" })],
      liveAssignedAttemptIds: new Set(["attempt-1"]),
    }));

    expect(terminal.waveDrained).toBe(true);
    expect(unavailable.waveDrained).toBe(true);
    expect(active.waveDrained).toBe(false);
  });

  it("drains retry-ineligible wave work only when no matching attempt remains live", () => {
    const scheduler = waveRecord(["task-1"]);
    scheduler.waveTargetState["task-1"].retryEligible = false;
    const unavailable = selectDispatches(baseInput({
      scheduler,
      tasks: [task("task-1", "todo", 1)],
    }));
    const active = selectDispatches(baseInput({
      scheduler,
      tasks: [task("task-1", "in_progress", 1, [], { current_attempt_id: "attempt-1" })],
      liveAssignedAttemptIds: new Set(["attempt-1"]),
    }));

    expect(unavailable.unavailable).toEqual({ "task-1": "retry_not_authorized" });
    expect(unavailable.waveDrained).toBe(true);
    expect(active.waveDrained).toBe(false);
  });

  it("reports plan terminal only when every task is done or blocked", () => {
    expect(selectDispatches(baseInput({ tasks: [task("task-1", "done", 1), task("task-2", "blocked", 1)] })).planTerminal)
      .toBe(true);
    expect(selectDispatches(baseInput({ tasks: [task("task-1", "done", 1), task("task-2", "todo", 0)] })).planTerminal)
      .toBe(false);
  });
});

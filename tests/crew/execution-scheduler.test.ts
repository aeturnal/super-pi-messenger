import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSchedulerEvent, type SchedulerEvent } from "../../crew/execution/events.js";
import {
  createScheduler,
  type ReconcileFacts,
  type ReconcileReason,
  type SchedulerDependencies,
  type TaskOutcomeFact,
} from "../../crew/execution/scheduler.js";
import type { SchedulerRecord } from "../../crew/execution/types.js";
import type { Task } from "../../crew/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: "todo",
    depends_on: [],
    created_at: now,
    updated_at: now,
    attempt_count: 0,
    ...overrides,
  };
}

function record(mode: SchedulerRecord["mode"] = "idle"): SchedulerRecord {
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness(options: {
  scheduler?: SchedulerRecord;
  tasks?: Task[];
  valid?: boolean;
  beforePersistScheduler?: (record: SchedulerRecord) => Promise<void> | void;
  onReadScheduler?: () => void;
  onReconcile?: SchedulerDependencies["onReconcile"];
  onSelectionRead?: () => void;
} = {}) {
  let persisted = structuredClone(options.scheduler ?? record());
  const tasks = options.tasks ?? [task("task-2"), task("task-1")];
  const events: SchedulerEvent[] = [];
  const timeline: string[] = [];
  const persistedHistory: Array<{ record: SchedulerRecord; timelineIndex: number }> = [];
  const reconcileCalls: ReconcileReason[][] = [];
  const liveAssignedAttemptIds = new Set<string>();
  let launchCount = 0;

  const deps: SchedulerDependencies = {
    now: () => now,
    validateLeaseAndRun: async () => options.valid ?? true,
    readScheduler: async () => {
      options.onReadScheduler?.();
      return structuredClone(persisted);
    },
    persistScheduler: async (next) => {
      if (options.beforePersistScheduler) await options.beforePersistScheduler(next);
      persisted = structuredClone(next);
      timeline.push(`persist:scheduler:${next.mode}`);
      persistedHistory.push({ record: structuredClone(next), timelineIndex: timeline.length - 1 });
    },
    appendEvent: async (event) => {
      events.push(structuredClone(event));
      timeline.push(`event:${event.name}`);
    },
    tasks: {
      list: async () => tasks.map((item) => structuredClone(item)),
      commitOutcome: async (fact) => {
        timeline.push(`persist:outcome:${fact.taskId}:${fact.attemptId}`);
        liveAssignedAttemptIds.delete(fact.attemptId);
        const changed = tasks.find((item) => item.id === fact.taskId);
        if (changed) {
          changed.status = "done";
          delete changed.current_attempt_id;
        }
      },
    },
    reviewer: {
      commit: async (fact) => {
        timeline.push(`persist:review:${fact.taskId}:${fact.attemptId}`);
      },
    },
    launcher: {
      dispatch: async (taskId) => {
        launchCount += 1;
        const attemptId = `attempt-${taskId}-${launchCount}`;
        timeline.push(`persist:attempt:${taskId}:${attemptId}`);
        liveAssignedAttemptIds.add(attemptId);
        const changed = tasks.find((item) => item.id === taskId);
        if (changed) {
          changed.status = "in_progress";
          changed.current_attempt_id = attemptId;
        }
        return { attemptId };
      },
    },
    selectionFacts: async () => ({
      liveAssignedAttemptIds: new Set(liveAssignedAttemptIds),
      reservedTaskIds: new Set(),
      get desiredConcurrency() {
        options.onSelectionRead?.();
        return 2;
      },
      maxAttemptsPerTask: 3,
      dependencies: "strict",
    }),
    onReconcile: async (reasons, facts) => {
      reconcileCalls.push([...reasons]);
      await options.onReconcile?.(reasons, facts);
    },
  };

  const scheduler = createScheduler(deps);
  return {
    scheduler,
    events: {
      names: () => events.map((event) => event.name),
      named: (name: SchedulerEvent["name"]) => events.filter((event) => event.name === name),
      all: events,
    },
    timeline,
    reconcileCalls,
    persistedHistory,
    persisted: () => structuredClone(persisted),
    persistedBefore: (name: SchedulerEvent["name"]) => {
      const eventIndex = timeline.indexOf(`event:${name}`);
      return eventIndex > 0 && timeline.slice(0, eventIndex).some((entry) => entry.startsWith("persist:scheduler:"));
    },
    liveAssignedAttemptIds,
    launchCount: () => launchCount,
  };
}

const reasonClasses: ReconcileReason[] = [
  "lease_or_run_invalidated",
  "durable_completion",
  "review_outcome",
  "cancellation",
  "child_close",
  "explicit_action",
  "configuration",
  "dependency_mutation",
  "overlay_refresh",
];

describe("canonical scheduler events", () => {
  it("appends versioned JSONL with canonical reason sets", () => {
    const { cwd } = createTempCrewDirs();
    appendSchedulerEvent(cwd, {
      version: 1,
      name: "scheduler.reconcile",
      at: now,
      planRunId: runId,
      controllerId: "controller-a",
      reasons: ["overlay_refresh", "configuration", "overlay_refresh"],
    });

    const lines = readFileSync(join(cwd, ".pi", "messenger", "crew", "scheduler-events.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as SchedulerEvent);
    expect(lines).toEqual([{
      version: 1,
      name: "scheduler.reconcile",
      at: now,
      planRunId: runId,
      controllerId: "controller-a",
      reasons: ["configuration", "overlay_refresh"],
    }]);
  });
});

describe("execution scheduler", () => {
  it("coalesces concurrent triggers into one pending pass without dropping reasons", async () => {
    const harness = createHarness({ scheduler: record("continuous"), tasks: [] });
    harness.scheduler.requestReconcile("overlay_refresh");
    harness.scheduler.requestReconcile("configuration");
    harness.scheduler.requestReconcile("overlay_refresh");
    await harness.scheduler.awaitIdle();

    expect(harness.events.named("scheduler.reconcile")[0]?.reasons)
      .toEqual(["configuration", "overlay_refresh"]);
    expect(harness.reconcileCalls).toHaveLength(1);
  });

  it("runs one merged follow-up pass for triggers received during a running pass", async () => {
    const started = deferred();
    const release = deferred();
    let calls = 0;
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [],
      onReconcile: async () => {
        calls += 1;
        if (calls === 1) {
          started.resolve();
          await release.promise;
        }
      },
    });

    harness.scheduler.requestReconcile("overlay_refresh");
    await started.promise;
    harness.scheduler.requestReconcile("configuration");
    harness.scheduler.requestReconcile("dependency_mutation");
    release.resolve();
    await harness.scheduler.awaitIdle();

    expect(harness.events.named("scheduler.reconcile").map((event) => event.reasons)).toEqual([
      ["overlay_refresh"],
      ["configuration", "dependency_mutation"],
    ]);
    expect(harness.reconcileCalls).toHaveLength(2);
  });

  it.each(reasonClasses)("accepts the %s reason class", async (reason) => {
    const harness = createHarness({ scheduler: record("continuous"), tasks: [] });
    harness.scheduler.requestReconcile(reason);
    await harness.scheduler.awaitIdle();

    expect(harness.events.named("scheduler.reconcile").map((event) => event.reasons)).toEqual([[reason]]);
  });

  it("processes reason classes by priority while displaying a canonical reason set", async () => {
    const harness = createHarness({ scheduler: record("continuous"), tasks: [] });
    for (const reason of [...reasonClasses].reverse()) harness.scheduler.requestReconcile(reason);
    await harness.scheduler.awaitIdle();

    expect(harness.reconcileCalls[0]).toEqual(reasonClasses);
    expect(harness.events.named("scheduler.reconcile")[0]?.reasons).toEqual([...reasonClasses].sort());
  });

  it("persists authorization acknowledgement before reconciliation and dispatch", async () => {
    const harness = createHarness();
    const ack = await harness.scheduler.authorize({ kind: "wave", requestedBy: "human", concurrency: 2 });
    expect(ack.accepted).toBe(true);
    expect(harness.persisted().waveSnapshotTaskIds).toEqual(["task-1", "task-2"]);
    await harness.scheduler.awaitIdle();

    expect(harness.events.names()).toEqual([
      "scheduler.authorized",
      "scheduler.reconcile",
      "task.dispatch",
      "task.dispatch",
    ]);
    expect(harness.persistedBefore("scheduler.authorized")).toBe(true);
  });

  it("builds a new wave snapshot without stale target authorization state", async () => {
    const staleWave = record("paused");
    staleWave.waveSnapshotTaskIds = ["task-1"];
    staleWave.waveTargetState = {
      "task-1": { authorized: true, retryEligible: false, terminal: false },
    };
    const harness = createHarness({
      scheduler: staleWave,
      tasks: [task("task-1", { attempt_count: 1 })],
    });

    await harness.scheduler.authorize({ kind: "wave", requestedBy: "human" });

    expect(harness.persisted()).toMatchObject({
      mode: "wave",
      waveSnapshotTaskIds: ["task-1"],
      waveTargetState: {
        "task-1": { authorized: true, retryEligible: true, terminal: false },
      },
    });
    await harness.scheduler.awaitIdle();
  });

  it("durably snapshots one targeted task", async () => {
    const harness = createHarness();
    await harness.scheduler.authorize({ kind: "targeted", taskId: "task-2", requestedBy: "human" });

    expect(harness.persisted()).toMatchObject({
      mode: "targeted",
      waveSnapshotTaskIds: ["task-2"],
      waveTargetState: {
        "task-2": { authorized: true, retryEligible: true, terminal: false },
      },
    });
    await harness.scheduler.awaitIdle();
  });

  it("persists pause and stop intent before acknowledging commands", async () => {
    const pauseHarness = createHarness({ scheduler: record("continuous") });
    const pauseAck = await pauseHarness.scheduler.pause("human");
    expect(pauseAck.accepted).toBe(true);
    expect(pauseHarness.persisted().mode).toBe("paused");
    expect(pauseHarness.events.names()[0]).toBe("scheduler.paused");
    await pauseHarness.scheduler.awaitIdle();

    const stopRecord = record("continuous");
    stopRecord.activeAttemptIds = ["attempt-2", "attempt-1"];
    const stopHarness = createHarness({ scheduler: stopRecord });
    const stopAck = await stopHarness.scheduler.stop("human", "user_stop");
    expect(stopAck.accepted).toBe(true);
    expect(stopHarness.persisted()).toMatchObject({
      mode: "paused",
      cancellationIntent: {
        requestedBy: "human",
        kind: "user_stop",
        attemptIds: ["attempt-1", "attempt-2"],
        requestedAt: now,
      },
    });
    await stopHarness.scheduler.awaitIdle();
  });

  it("serializes pause behind a running pass so no stale dispatch follows acknowledgement", async () => {
    const started = deferred();
    const release = deferred();
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [task("task-1")],
      onReconcile: async () => {
        started.resolve();
        await release.promise;
      },
    });

    harness.scheduler.requestReconcile("overlay_refresh");
    await started.promise;
    const pause = harness.scheduler.pause("human");
    release.resolve();
    await pause;
    const dispatchesAtAck = harness.events.named("task.dispatch").length;
    await harness.scheduler.awaitIdle();

    const pausedEvent = harness.events.names().indexOf("scheduler.paused");
    expect(harness.events.named("task.dispatch")).toHaveLength(dispatchesAtAck);
    expect(harness.events.names().lastIndexOf("task.dispatch")).toBeLessThan(pausedEvent);
    expect(harness.persisted().mode).toBe("paused");
  });

  it("serializes stop behind a running pass so cancellation intent survives", async () => {
    const started = deferred();
    const release = deferred();
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [task("task-1")],
      onReconcile: async () => {
        started.resolve();
        await release.promise;
      },
    });

    harness.scheduler.requestReconcile("overlay_refresh");
    await started.promise;
    const stop = harness.scheduler.stop("human", "user_stop");
    release.resolve();
    await stop;
    const dispatchesAtAck = harness.events.named("task.dispatch").length;
    await harness.scheduler.awaitIdle();

    const pausedEvent = harness.events.names().indexOf("scheduler.paused");
    expect(harness.events.named("task.dispatch")).toHaveLength(dispatchesAtAck);
    expect(harness.events.names().lastIndexOf("task.dispatch")).toBeLessThan(pausedEvent);
    expect(harness.persisted()).toMatchObject({
      mode: "paused",
      cancellationIntent: {
        requestedBy: "human",
        kind: "user_stop",
        requestedAt: now,
      },
    });
  });

  it("serializes replacement authorization behind a running pass without stale target overwrite", async () => {
    const started = deferred();
    const release = deferred();
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [task("task-1"), task("task-2")],
      onReconcile: async () => {
        started.resolve();
        await release.promise;
      },
    });

    harness.scheduler.requestReconcile("overlay_refresh");
    await started.promise;
    const authorize = harness.scheduler.authorize({
      kind: "targeted",
      taskId: "task-2",
      requestedBy: "human",
    });
    release.resolve();
    await authorize;
    const staleDispatchesAtAck = harness.events.all.filter(
      (event) => event.name === "task.dispatch" && event.taskId === "task-1",
    ).length;
    await harness.scheduler.awaitIdle();

    const staleDispatchesAfterIdle = harness.events.all.filter(
      (event) => event.name === "task.dispatch" && event.taskId === "task-1",
    ).length;
    const authorizedEvent = harness.events.names().indexOf("scheduler.authorized");
    const staleDispatch = harness.events.all.findIndex(
      (event) => event.name === "task.dispatch" && event.taskId === "task-1",
    );
    expect(staleDispatchesAfterIdle).toBe(staleDispatchesAtAck);
    expect(staleDispatch).toBeLessThan(authorizedEvent);
    expect(harness.persisted()).toMatchObject({
      mode: "targeted",
      waveSnapshotTaskIds: ["task-2"],
      waveTargetState: {
        "task-2": { authorized: true, retryEligible: true, terminal: false },
      },
    });
  });

  it("serializes concurrent commands in invocation order", async () => {
    const harness = createHarness({ tasks: [task("task-2")] });
    const authorize = harness.scheduler.authorize({
      kind: "targeted",
      taskId: "task-2",
      requestedBy: "human",
    });
    const stop = harness.scheduler.stop("human", "user_stop");

    await Promise.all([authorize, stop]);
    await harness.scheduler.awaitIdle();

    expect(harness.persisted()).toMatchObject({
      mode: "paused",
      waveSnapshotTaskIds: ["task-2"],
      waveTargetState: {
        "task-2": { authorized: true, retryEligible: true, terminal: false },
      },
      cancellationIntent: {
        requestedBy: "human",
        kind: "user_stop",
      },
    });
  });

  it("acquires command ownership atomically against an idle-boundary reconcile request", async () => {
    const passStarted = deferred();
    const releasePass = deferred();
    const selectionRead = deferred();
    let commandMutationOpen = false;
    let overlapObserved = false;
    let readCount = 0;
    let heldCommandPersist = false;
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [task("task-1")],
      onReadScheduler: () => {
        readCount += 1;
        if (readCount === 1) commandMutationOpen = true;
        else overlapObserved ||= commandMutationOpen;
      },
      beforePersistScheduler: async (next) => {
        if (next.mode !== "paused" || heldCommandPersist) return;
        heldCommandPersist = true;
        const noOverlappingPass = deferred();
        queueMicrotask(noOverlappingPass.resolve);
        await Promise.race([passStarted.promise, noOverlappingPass.promise]);
        commandMutationOpen = false;
      },
      onReconcile: async () => {
        passStarted.resolve();
        await releasePass.promise;
      },
      onSelectionRead: selectionRead.resolve,
    });

    const pause = harness.scheduler.pause("human");
    const reconcileRequested = deferred();
    queueMicrotask(() => {
      harness.scheduler.requestReconcile("overlay_refresh");
      reconcileRequested.resolve();
    });

    await reconcileRequested.promise;
    await pause;
    await passStarted.promise;
    const dispatchesAtAck = harness.launchCount();
    let idleResolved = false;
    const idle = harness.scheduler.awaitIdle().then(() => { idleResolved = true; });
    await Promise.resolve();
    const idleResolvedBeforePassRelease = idleResolved;

    releasePass.resolve();
    await selectionRead.promise;
    await Promise.resolve();
    await idle;

    expect({
      overlapObserved,
      idleResolvedBeforePassRelease,
      dispatchesAfterAck: harness.launchCount() - dispatchesAtAck,
      durableMode: harness.persisted().mode,
    }).toEqual({
      overlapObserved: false,
      idleResolvedBeforePassRelease: false,
      dispatchesAfterAck: 0,
      durableMode: "paused",
    });
  });

  it("orders task outcomes, then reviews, then dispatches after freed slots", async () => {
    const active = record("continuous");
    active.activeAttemptIds = ["attempt-2", "attempt-1"];
    const harness = createHarness({
      scheduler: active,
      tasks: [
        task("task-1", { status: "in_progress", current_attempt_id: "attempt-1" }),
        task("task-2", { status: "in_progress", current_attempt_id: "attempt-2" }),
        task("task-3"),
      ],
    });
    harness.liveAssignedAttemptIds.add("attempt-1");
    harness.liveAssignedAttemptIds.add("attempt-2");
    const facts: ReconcileFacts = {
      taskOutcomes: [
        { name: "task.worker_crash", taskId: "task-2", attemptId: "attempt-2" },
        { name: "task.cancelled", taskId: "task-1", attemptId: "attempt-1" },
      ],
      reviewOutcomes: [
        { name: "task.review_completed", taskId: "task-1", attemptId: "attempt-1" },
      ],
    };

    harness.scheduler.requestReconcile("durable_completion", facts);
    await harness.scheduler.awaitIdle();

    expect(harness.events.names()).toEqual([
      "scheduler.reconcile",
      "task.cancelled",
      "task.worker_crash",
      "task.review_completed",
      "task.dispatch",
    ]);
    expect(harness.timeline.indexOf("persist:outcome:task-1:attempt-1"))
      .toBeLessThan(harness.timeline.indexOf("event:task.cancelled"));
    expect(harness.timeline.indexOf("persist:review:task-1:attempt-1"))
      .toBeLessThan(harness.timeline.indexOf("event:task.review_completed"));
    expect(harness.timeline.indexOf("event:task.review_completed"))
      .toBeLessThan(harness.timeline.indexOf("event:task.dispatch"));
  });

  it("sorts multiple task outcomes by task ID then attempt ID", async () => {
    const harness = createHarness({ scheduler: record("paused"), tasks: [] });
    const taskOutcomes: TaskOutcomeFact[] = [
      { name: "task.worker_crash", taskId: "task-2", attemptId: "attempt-1" },
      { name: "task.protocol_incomplete", taskId: "task-1", attemptId: "attempt-2" },
      { name: "task.cancelled", taskId: "task-1", attemptId: "attempt-1" },
    ];
    harness.scheduler.requestReconcile("durable_completion", { taskOutcomes });
    await harness.scheduler.awaitIdle();

    expect(harness.events.all.filter((event) => event.taskId).map((event) => [event.taskId, event.attemptId]))
      .toEqual([
        ["task-1", "attempt-1"],
        ["task-1", "attempt-2"],
        ["task-2", "attempt-1"],
      ]);
  });

  it("emits scheduler.idle last after a wave drains", async () => {
    const wave = record("wave");
    wave.waveSnapshotTaskIds = ["task-1"];
    wave.waveTargetState = {
      "task-1": { authorized: true, retryEligible: true, terminal: false },
    };
    const harness = createHarness({
      scheduler: wave,
      tasks: [task("task-1", { status: "in_progress", current_attempt_id: "attempt-1" })],
    });
    harness.liveAssignedAttemptIds.add("attempt-1");
    harness.scheduler.requestReconcile("durable_completion", {
      taskOutcomes: [{ name: "task.cancelled", taskId: "task-1", attemptId: "attempt-1" }],
    });
    await harness.scheduler.awaitIdle();

    expect(harness.events.names()).toEqual([
      "scheduler.reconcile",
      "task.cancelled",
      "scheduler.idle",
    ]);
    expect(harness.persisted().mode).toBe("idle");
  });

  it("persists deterministic wave unavailability before emitting idle", async () => {
    const wave = record("wave");
    wave.waveSnapshotTaskIds = ["task-1"];
    wave.waveTargetState = {
      "task-1": { authorized: true, retryEligible: false, terminal: false },
    };
    const harness = createHarness({
      scheduler: wave,
      tasks: [task("task-1", { attempt_count: 1 })],
    });

    harness.scheduler.requestReconcile("overlay_refresh");
    await harness.scheduler.awaitIdle();

    const unavailableCommit = harness.persistedHistory.find(
      ({ record: persistedRecord }) => persistedRecord.waveTargetState["task-1"]?.unavailableReason
        === "retry_not_authorized",
    );
    expect(unavailableCommit).toBeDefined();
    expect(unavailableCommit?.timelineIndex)
      .toBeLessThan(harness.timeline.indexOf("event:scheduler.idle"));
    expect(harness.persisted()).toMatchObject({
      mode: "idle",
      waveTargetState: {
        "task-1": { unavailableReason: "retry_not_authorized" },
      },
    });
  });

  it("does not emit idle while continuous mode is temporarily waiting", async () => {
    const harness = createHarness({
      scheduler: record("continuous"),
      tasks: [task("task-1", { status: "review_pending" })],
    });
    harness.scheduler.requestReconcile("overlay_refresh");
    await harness.scheduler.awaitIdle();

    expect(harness.events.names()).toEqual(["scheduler.reconcile"]);
  });

  it("returns from an invalid pass without repository, reviewer, launcher, or event side effects", async () => {
    const harness = createHarness({ scheduler: record("continuous"), valid: false });
    harness.scheduler.requestReconcile("overlay_refresh", {
      taskOutcomes: [{ name: "task.cancelled", taskId: "task-1", attemptId: "attempt-1" }],
      reviewOutcomes: [{ name: "task.review_failed", taskId: "task-1", attemptId: "attempt-1" }],
    });
    await harness.scheduler.awaitIdle();

    expect(harness.events.names()).toEqual([]);
    expect(harness.reconcileCalls).toEqual([]);
    expect(harness.launchCount()).toBe(0);
    expect(harness.timeline).toEqual([]);
  });
});

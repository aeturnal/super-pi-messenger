import type { Task } from "../types.js";
import { canonicalReasons, type SchedulerEvent, type SchedulerEventName } from "./events.js";
import {
  isDeterministicUnavailableReason,
  selectDispatches,
  type SelectionInput,
} from "./selection.js";
import type { CancellationKind, ExecutionMode, SchedulerRecord } from "./types.js";

export type ReconcileReason =
  | "lease_or_run_invalidated"
  | "durable_completion"
  | "review_outcome"
  | "cancellation"
  | "child_close"
  | "explicit_action"
  | "configuration"
  | "dependency_mutation"
  | "overlay_refresh";

export interface TaskOutcomeFact {
  name: "task.protocol_incomplete" | "task.worker_crash" | "task.cancelled" | "task.review_pending";
  taskId: string;
  attemptId: string;
  fields?: Record<string, unknown>;
}

export interface ReviewOutcomeFact {
  name: "task.review_claimed" | "task.review_completed" | "task.review_failed";
  taskId: string;
  attemptId: string;
  fields?: Record<string, unknown>;
}

export interface ReconcileFacts {
  taskOutcomes?: TaskOutcomeFact[];
  reviewOutcomes?: ReviewOutcomeFact[];
}

export interface SchedulerTaskRepository {
  list(): Promise<Task[]> | Task[];
  commitOutcome(fact: TaskOutcomeFact): Promise<void> | void;
}

export interface SchedulerReviewer {
  commit(fact: ReviewOutcomeFact): Promise<void> | void;
}

export interface SchedulerLauncher {
  dispatch(taskId: string): Promise<{ attemptId: string }> | { attemptId: string };
}

export type SchedulerSelectionFacts = Omit<
  SelectionInput,
  "scheduler" | "tasks" | "desiredConcurrency"
> & { desiredConcurrency: number };

export interface SchedulerDependencies {
  now(): string;
  validateLeaseAndRun(): Promise<boolean> | boolean;
  readScheduler(): Promise<SchedulerRecord> | SchedulerRecord;
  persistScheduler(record: SchedulerRecord): Promise<void> | void;
  appendEvent(event: SchedulerEvent): Promise<void> | void;
  tasks: SchedulerTaskRepository;
  reviewer: SchedulerReviewer;
  launcher: SchedulerLauncher;
  selectionFacts(): Promise<SchedulerSelectionFacts> | SchedulerSelectionFacts;
  onReconcile?(reasons: ReconcileReason[], facts: ReconcileFacts): Promise<void> | void;
}

export type AuthorizationCommand =
  | { kind: "wave" | "continuous"; requestedBy: string; concurrency?: number }
  | { kind: "targeted"; taskId: string; requestedBy: string; concurrency?: number };

export type CommandAck =
  | { accepted: true; mode: ExecutionMode }
  | { accepted: false; mode: ExecutionMode; reason: "lease_or_run_invalidated" };

export interface ExecutionScheduler {
  authorize(command: AuthorizationCommand): Promise<CommandAck>;
  requestReconcile(reason: ReconcileReason, facts?: ReconcileFacts): void;
  pause(requestedBy: string): Promise<CommandAck>;
  stop(requestedBy: string, kind: CancellationKind): Promise<CommandAck>;
  awaitIdle(): Promise<void>;
}

const reasonPriority: Record<ReconcileReason, number> = {
  lease_or_run_invalidated: 0,
  durable_completion: 1,
  review_outcome: 2,
  cancellation: 3,
  child_close: 4,
  explicit_action: 5,
  configuration: 6,
  dependency_mutation: 7,
  overlay_refresh: 8,
};

function compareFacts(
  left: { taskId: string; attemptId: string },
  right: { taskId: string; attemptId: string },
): number {
  return left.taskId.localeCompare(right.taskId) || left.attemptId.localeCompare(right.attemptId);
}

function targetState(taskIds: string[]): SchedulerRecord["waveTargetState"] {
  return Object.fromEntries(taskIds.map((taskId) => [taskId, {
    authorized: true,
    retryEligible: true,
    terminal: false,
  }]));
}

export function createScheduler(deps: SchedulerDependencies): ExecutionScheduler {
  let running = false;
  let queued = false;
  let pending = false;
  const pendingReasons = new Set<ReconcileReason>();
  let pendingFacts: ReconcileFacts = {};
  let idleError: unknown;
  let commandActive = false;
  let commandsPending = 0;
  let commandTail: Promise<void> = Promise.resolve();
  const passWaiters: Array<() => void> = [];
  const waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  function mergeFacts(facts: ReconcileFacts | undefined): void {
    if (!facts) return;
    if (facts.taskOutcomes?.length) {
      pendingFacts.taskOutcomes = [...(pendingFacts.taskOutcomes ?? []), ...facts.taskOutcomes];
    }
    if (facts.reviewOutcomes?.length) {
      pendingFacts.reviewOutcomes = [...(pendingFacts.reviewOutcomes ?? []), ...facts.reviewOutcomes];
    }
  }

  function takeFacts(): ReconcileFacts {
    const facts = pendingFacts;
    pendingFacts = {};
    return facts;
  }

  async function emit(
    record: SchedulerRecord,
    name: SchedulerEventName,
    reasons: Iterable<string>,
    details: Pick<SchedulerEvent, "taskId" | "attemptId" | "fields"> = {},
  ): Promise<void> {
    await deps.appendEvent({
      version: 1,
      name,
      at: deps.now(),
      planRunId: record.runId,
      controllerId: record.controllerId,
      reasons: canonicalReasons(reasons),
      ...details,
    });
  }

  async function reconcilePass(reasons: ReconcileReason[], facts: ReconcileFacts): Promise<void> {
    if (!await deps.validateLeaseAndRun()) return;

    let scheduler = await deps.readScheduler();
    await deps.onReconcile?.(reasons, facts);
    await emit(scheduler, "scheduler.reconcile", reasons);

    const eventReasons = canonicalReasons(reasons);
    for (const outcome of [...(facts.taskOutcomes ?? [])].sort(compareFacts)) {
      await deps.tasks.commitOutcome(outcome);
      if (scheduler.activeAttemptIds.includes(outcome.attemptId)) {
        scheduler = {
          ...scheduler,
          activeAttemptIds: scheduler.activeAttemptIds.filter((attemptId) => attemptId !== outcome.attemptId),
        };
        await deps.persistScheduler(scheduler);
      }
      await emit(scheduler, outcome.name, eventReasons, outcome);
    }

    for (const review of [...(facts.reviewOutcomes ?? [])].sort(compareFacts)) {
      await deps.reviewer.commit(review);
      await emit(scheduler, review.name, eventReasons, review);
    }

    const tasks = await deps.tasks.list();
    const runtime = await deps.selectionFacts();
    const selection = selectDispatches({
      ...runtime,
      scheduler,
      tasks,
      desiredConcurrency: scheduler.desiredConcurrencyOverride ?? runtime.desiredConcurrency,
    });

    if (scheduler.mode === "wave" || scheduler.mode === "targeted") {
      let changed = false;
      const waveTargetState = { ...scheduler.waveTargetState };
      for (const taskId of scheduler.waveSnapshotTaskIds) {
        const reason = selection.unavailable[taskId];
        const target = waveTargetState[taskId];
        if (reason && target && isDeterministicUnavailableReason(reason) && target.unavailableReason !== reason) {
          waveTargetState[taskId] = { ...target, unavailableReason: reason };
          changed = true;
        }
      }
      if (changed) {
        scheduler = { ...scheduler, waveTargetState };
        await deps.persistScheduler(scheduler);
      }
    }

    for (const taskId of selection.taskIds) {
      const dispatch = await deps.launcher.dispatch(taskId);
      scheduler = {
        ...scheduler,
        activeAttemptIds: [...new Set([...scheduler.activeAttemptIds, dispatch.attemptId])]
          .sort((left, right) => left.localeCompare(right)),
      };
      await deps.persistScheduler(scheduler);
      await emit(scheduler, "task.dispatch", eventReasons, {
        taskId,
        attemptId: dispatch.attemptId,
      });
    }

    const shouldIdle = selection.waveDrained
      || (scheduler.mode === "continuous" && selection.planTerminal);
    if (shouldIdle) {
      scheduler = { ...scheduler, mode: "idle" };
      await deps.persistScheduler(scheduler);
      await emit(scheduler, "scheduler.idle", eventReasons);
    }
  }

  function passIsIdle(): boolean {
    return !queued && !running && !pending;
  }

  function settleWaiters(): void {
    if (!passIsIdle()) return;
    for (const resolve of passWaiters.splice(0)) resolve();
    if (commandActive || commandsPending > 0) return;

    const settled = waiters.splice(0);
    if (idleError !== undefined) {
      for (const waiter of settled) waiter.reject(idleError);
      return;
    }
    for (const waiter of settled) waiter.resolve();
  }

  function awaitPassIdle(): Promise<void> {
    if (passIsIdle()) return Promise.resolve();
    return new Promise<void>((resolve) => { passWaiters.push(resolve); });
  }

  async function runLoop(): Promise<void> {
    queued = false;
    running = true;
    try {
      do {
        pending = false;
        const reasons = [...pendingReasons].sort((left, right) => reasonPriority[left] - reasonPriority[right]);
        pendingReasons.clear();
        await reconcilePass(reasons, takeFacts());
      } while (pending || pendingReasons.size > 0);
    } catch (error) {
      idleError = error;
      pending = false;
      pendingReasons.clear();
      pendingFacts = {};
    } finally {
      running = false;
      settleWaiters();
    }
  }

  function requestReconcile(reason: ReconcileReason, facts?: ReconcileFacts): void {
    if (!commandActive && !running && !queued) idleError = undefined;
    pendingReasons.add(reason);
    mergeFacts(facts);
    if (commandActive || running) {
      pending = true;
      return;
    }
    if (queued) return;
    queued = true;
    queueMicrotask(() => { void runLoop(); });
  }

  async function acquireCommandOwnership(): Promise<void> {
    while (true) {
      if (!commandActive && passIsIdle()) {
        commandActive = true;
        return;
      }
      await awaitPassIdle();
    }
  }

  function serializeCommand<T>(command: () => Promise<T>): Promise<T> {
    commandsPending += 1;
    const result = commandTail.then(async () => {
      await acquireCommandOwnership();
      try {
        return await command();
      } finally {
        commandActive = false;
        commandsPending -= 1;
        if (pending || pendingReasons.size > 0) {
          pending = false;
          queued = true;
          queueMicrotask(() => { void runLoop(); });
        }
        settleWaiters();
      }
    });
    commandTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function rejectInvalid(current: SchedulerRecord): Promise<CommandAck | undefined> {
    if (await deps.validateLeaseAndRun()) return undefined;
    return { accepted: false, mode: current.mode, reason: "lease_or_run_invalidated" };
  }

  async function authorizeNow(command: AuthorizationCommand): Promise<CommandAck> {
    const current = await deps.readScheduler();
    const rejected = await rejectInvalid(current);
    if (rejected) return rejected;

    let snapshotTaskIds: string[] = [];
    if (command.kind === "wave") {
      const tasks = await deps.tasks.list();
      const runtime = await deps.selectionFacts();
      snapshotTaskIds = selectDispatches({
        ...runtime,
        scheduler: {
          ...current,
          mode: "continuous",
          waveSnapshotTaskIds: [],
          waveTargetState: {},
        },
        tasks,
        desiredConcurrency: Number.MAX_SAFE_INTEGER,
      }).taskIds;
    } else if (command.kind === "targeted") {
      snapshotTaskIds = [command.taskId];
    }

    const next: SchedulerRecord = {
      ...current,
      mode: command.kind,
      waveSnapshotTaskIds: snapshotTaskIds,
      waveTargetState: targetState(snapshotTaskIds),
      desiredConcurrencyOverride: command.concurrency ?? null,
      cancellationIntent: null,
    };
    await deps.persistScheduler(next);
    await emit(next, "scheduler.authorized", [], {
      fields: { requestedBy: command.requestedBy, mode: command.kind },
    });
    requestReconcile("explicit_action");
    return { accepted: true, mode: next.mode };
  }

  async function pauseNow(requestedBy: string): Promise<CommandAck> {
    const current = await deps.readScheduler();
    const rejected = await rejectInvalid(current);
    if (rejected) return rejected;

    const next: SchedulerRecord = { ...current, mode: "paused" };
    await deps.persistScheduler(next);
    await emit(next, "scheduler.paused", [], { fields: { requestedBy } });
    requestReconcile("explicit_action");
    return { accepted: true, mode: next.mode };
  }

  async function stopNow(requestedBy: string, kind: CancellationKind): Promise<CommandAck> {
    const current = await deps.readScheduler();
    const rejected = await rejectInvalid(current);
    if (rejected) return rejected;

    const next: SchedulerRecord = {
      ...current,
      mode: "paused",
      cancellationIntent: {
        requestedBy,
        kind,
        attemptIds: [...current.activeAttemptIds].sort((left, right) => left.localeCompare(right)),
        requestedAt: deps.now(),
      },
    };
    await deps.persistScheduler(next);
    await emit(next, "scheduler.paused", [], { fields: { requestedBy, kind } });
    requestReconcile("cancellation");
    return { accepted: true, mode: next.mode };
  }

  function awaitIdle(): Promise<void> {
    if (passIsIdle() && !commandActive && commandsPending === 0) {
      if (idleError !== undefined) {
        const error = idleError;
        idleError = undefined;
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => { waiters.push({ resolve, reject }); });
  }

  return {
    authorize: (command) => serializeCommand(() => authorizeNow(command)),
    requestReconcile,
    pause: (requestedBy) => serializeCommand(() => pauseNow(requestedBy)),
    stop: (requestedBy, kind) => serializeCommand(() => stopNow(requestedBy, kind)),
    awaitIdle,
  };
}

import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendSchedulerEvent, type SchedulerEvent, type SchedulerEventName } from "./events.js";
import { findWorkerByAttempt } from "../registry.js";
import * as taskStore from "../store.js";
import type { Task } from "../types.js";
import { readAttempt, readSchedulerRecord, updateAttempt, writeSchedulerRecord } from "./store.js";
import type { AttemptCancellation, AttemptRecord, CancellationKind } from "./types.js";

export type CloseClassification =
  | { kind: "completed" | "review_pending" }
  | { kind: "cancelled"; cancellation: AttemptCancellation }
  | { kind: "protocol_incomplete"; blockedCode: "protocol_incomplete" }
  | { kind: "worker_crash"; blockedCode: "worker_crash" };

export interface ClassifyChildCloseInput {
  attemptId: string;
  task: Pick<Task, "status" | "completion_attempt_id" | "legacy_review_state">;
  cancellation: AttemptCancellation | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface AttemptReconciliationDependencies {
  updateTask: typeof taskStore.updateTask;
  writeSchedulerRecord: typeof writeSchedulerRecord;
  appendTaskProgress: typeof taskStore.appendTaskProgress;
  appendSchedulerEvent: typeof appendSchedulerEvent;
  updateAttempt: typeof updateAttempt;
}

const defaultAttemptReconciliationDependencies: AttemptReconciliationDependencies = {
  updateTask: taskStore.updateTask,
  writeSchedulerRecord,
  appendTaskProgress: taskStore.appendTaskProgress,
  appendSchedulerEvent,
  updateAttempt,
};

export function classifyChildClose(input: ClassifyChildCloseInput): CloseClassification {
  const matchingReview = input.task.legacy_review_state?.attemptId === input.attemptId;
  const matchingCompletion = input.task.completion_attempt_id === input.attemptId || matchingReview;

  if (input.task.status === "done" && matchingCompletion) return { kind: "completed" };
  if (input.task.status === "review_pending" && matchingReview) return { kind: "review_pending" };
  if (input.cancellation) return { kind: "cancelled", cancellation: input.cancellation };
  if (input.exitCode === 0) {
    return { kind: "protocol_incomplete", blockedCode: "protocol_incomplete" };
  }
  return { kind: "worker_crash", blockedCode: "worker_crash" };
}

export interface CompensateLaunchRequest {
  cwd: string;
  taskId: string;
  attemptId: string;
  attemptCharged: boolean;
}

export function compensateLaunchAttempt(request: CompensateLaunchRequest): boolean {
  const attempt = readAttempt(request.cwd, request.attemptId);
  const charged = attempt?.attemptCharged ?? request.attemptCharged;
  let changed = false;

  const task = taskStore.getTask(request.cwd, request.taskId);
  if (task?.current_attempt_id === request.attemptId) {
    taskStore.updateTask(request.cwd, request.taskId, {
      status: "todo",
      assigned_to: undefined,
      current_attempt_id: undefined,
      attempt_count: charged ? Math.max(0, task.attempt_count - 1) : task.attempt_count,
    });
    changed = true;
  }

  const scheduler = readSchedulerRecord(request.cwd);
  if (scheduler?.activeAttemptIds.includes(request.attemptId)) {
    writeSchedulerRecord(request.cwd, {
      ...scheduler,
      activeAttemptIds: scheduler.activeAttemptIds.filter(id => id !== request.attemptId),
    });
    changed = true;
  }

  if (attempt && !attempt.rollbackApplied) {
    updateAttempt(request.cwd, request.attemptId, current => ({
      ...current,
      rollbackApplied: true,
    }));
    changed = true;
  }
  return changed;
}

export interface ApplyRollbackRequest {
  cwd: string;
  attemptId: string;
}

export function applyRollbackOnce(request: ApplyRollbackRequest): boolean {
  const attempt = readAttempt(request.cwd, request.attemptId);
  if (!attempt || !attempt.attemptCharged || attempt.rollbackApplied) return false;
  return compensateLaunchAttempt({
    cwd: request.cwd,
    taskId: attempt.taskId,
    attemptId: request.attemptId,
    attemptCharged: attempt.attemptCharged,
  });
}

export interface PersistCancellationRequest {
  cwd: string;
  requestedBy: string;
  kind: CancellationKind;
  attemptIds: string[];
  requestedAt: string;
}

export function persistCancellation(request: PersistCancellationRequest): void {
  const scheduler = readSchedulerRecord(request.cwd);
  if (!scheduler) throw new Error("Scheduler record does not exist");

  const attempts = request.attemptIds.map(attemptId => {
    const attempt = readAttempt(request.cwd, attemptId);
    if (!attempt) throw new Error(`Attempt ${attemptId} does not exist`);
    return attempt;
  });
  const cancellation: AttemptCancellation = {
    kind: request.kind,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
  };

  writeSchedulerRecord(request.cwd, {
    ...scheduler,
    cancellationIntent: {
      requestedBy: request.requestedBy,
      kind: request.kind,
      attemptIds: [...request.attemptIds],
      requestedAt: request.requestedAt,
    },
  });
  for (const attempt of attempts) {
    updateAttempt(request.cwd, attempt.attemptId, current => ({ ...current, cancellation }));
  }
}

export interface SignalCancelledAttemptsRequest {
  cwd: string;
  attemptIds: string[];
  signal?: NodeJS.Signals;
}

export function signalCancelledAttempts(request: SignalCancelledAttemptsRequest): number {
  const scheduler = readSchedulerRecord(request.cwd);
  const intent = scheduler?.cancellationIntent;
  const workers: ChildProcess[] = [];

  for (const attemptId of request.attemptIds) {
    const attempt = readAttempt(request.cwd, attemptId);
    if (!intent?.attemptIds.includes(attemptId) || !attempt?.cancellation
      || attempt.cancellation.kind !== intent.kind
      || attempt.cancellation.requestedAt !== intent.requestedAt) {
      throw new Error(`Attempt ${attemptId} is not durably cancelled`);
    }
    const worker = findWorkerByAttempt(request.cwd, attemptId);
    if (worker && worker.proc.exitCode === null && !worker.proc.killed) workers.push(worker.proc);
  }

  for (const proc of workers) proc.kill(request.signal ?? "SIGTERM");
  return workers.length;
}

export interface ReconcileChildCloseRequest {
  cwd: string;
  attemptId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  closedAt: string;
}

function removeActiveAttempt(
  cwd: string,
  attemptId: string,
  dependencies: AttemptReconciliationDependencies = defaultAttemptReconciliationDependencies,
): void {
  const scheduler = readSchedulerRecord(cwd);
  if (!scheduler?.activeAttemptIds.includes(attemptId)) return;
  dependencies.writeSchedulerRecord(cwd, {
    ...scheduler,
    activeAttemptIds: scheduler.activeAttemptIds.filter(id => id !== attemptId),
  });
}

const closeEventNames: Record<CloseClassification["kind"], SchedulerEventName> = {
  completed: "scheduler.reconcile",
  review_pending: "task.review_pending",
  cancelled: "task.cancelled",
  protocol_incomplete: "task.protocol_incomplete",
  worker_crash: "task.worker_crash",
};

function closeEvent(
  request: ReconcileChildCloseRequest,
  attempt: AttemptRecord,
  classification: CloseClassification,
): SchedulerEvent {
  return {
    version: 1,
    name: closeEventNames[classification.kind],
    at: request.closedAt,
    planRunId: attempt.runId,
    controllerId: attempt.controllerId,
    reasons: classification.kind === "cancelled" ? ["cancellation", "child_close"] : ["child_close"],
    taskId: attempt.taskId,
    attemptId: attempt.attemptId,
    fields: { exitCode: request.exitCode, signal: request.signal },
  };
}

function cancellationProgress(attemptId: string, cancellation: AttemptCancellation): string {
  return `Attempt ${attemptId} cancelled by ${cancellation.requestedBy}`;
}

function hasCancellationEvent(cwd: string, attemptId: string): boolean {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "scheduler-events.jsonl");
  if (!fs.existsSync(filePath)) return false;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid scheduler event log at ${filePath}`, { cause: error });
    }
    if (typeof event === "object" && event !== null
      && (event as Record<string, unknown>).name === "task.cancelled"
      && (event as Record<string, unknown>).attemptId === attemptId) return true;
  }
  return false;
}

function reconcileCancellation(
  request: ReconcileChildCloseRequest,
  attempt: AttemptRecord,
  cancellation: AttemptCancellation,
  dependencies: AttemptReconciliationDependencies,
): void {
  const task = taskStore.getTask(request.cwd, attempt.taskId);
  if (!task) throw new Error(`Task ${attempt.taskId} does not exist`);
  if (task.current_attempt_id === request.attemptId) {
    dependencies.updateTask(request.cwd, attempt.taskId, {
      status: "todo",
      assigned_to: undefined,
      current_attempt_id: undefined,
      attempt_count: attempt.attemptCharged
        ? Math.max(0, task.attempt_count - 1)
        : task.attempt_count,
    });
  }

  removeActiveAttempt(request.cwd, request.attemptId, dependencies);

  const progress = cancellationProgress(request.attemptId, cancellation);
  if (!(taskStore.getTaskProgress(request.cwd, attempt.taskId) ?? "").includes(progress)) {
    dependencies.appendTaskProgress(request.cwd, attempt.taskId, "system", progress);
  }

  if (!hasCancellationEvent(request.cwd, request.attemptId)) {
    dependencies.appendSchedulerEvent(request.cwd, closeEvent(request, attempt, {
      kind: "cancelled",
      cancellation,
    }));
  }

  const latestAttempt = readAttempt(request.cwd, request.attemptId);
  if (latestAttempt && !latestAttempt.rollbackApplied) {
    dependencies.updateAttempt(request.cwd, request.attemptId, current => ({
      ...current,
      rollbackApplied: true,
    }));
  }
}

export function reconcileChildClose(
  request: ReconcileChildCloseRequest,
  dependencyOverrides: Partial<AttemptReconciliationDependencies> = {},
): CloseClassification {
  const dependencies = { ...defaultAttemptReconciliationDependencies, ...dependencyOverrides };
  let attempt = readAttempt(request.cwd, request.attemptId);
  if (!attempt) throw new Error(`Attempt ${request.attemptId} does not exist`);
  const scheduler = readSchedulerRecord(request.cwd);
  if (!scheduler) throw new Error("Scheduler record does not exist");
  const task = taskStore.getTask(request.cwd, attempt.taskId);
  if (!task) throw new Error(`Task ${attempt.taskId} does not exist`);

  const firstClose = attempt.state !== "closed";
  if (firstClose) {
    attempt = dependencies.updateAttempt(request.cwd, request.attemptId, current => ({
      ...current,
      state: "closed",
      closedAt: request.closedAt,
      exitCode: request.exitCode,
      signal: request.signal,
    }));
  }

  const classification = classifyChildClose({
    attemptId: request.attemptId,
    task,
    cancellation: attempt.cancellation,
    exitCode: request.exitCode,
    signal: request.signal,
  });

  if (classification.kind === "cancelled") {
    reconcileCancellation(request, attempt, classification.cancellation, dependencies);
    return classification;
  }

  if (firstClose && task.current_attempt_id === request.attemptId) {
    if (classification.kind === "completed" || classification.kind === "review_pending") {
      dependencies.updateTask(request.cwd, attempt.taskId, {
        assigned_to: undefined,
        current_attempt_id: undefined,
      });
    } else if (classification.kind === "protocol_incomplete") {
      dependencies.updateTask(request.cwd, attempt.taskId, {
        status: "blocked",
        assigned_to: undefined,
        current_attempt_id: undefined,
        blocked_code: classification.blockedCode,
        blocked_reason: "Worker exited without completing the task protocol",
      });
    } else if (classification.kind === "worker_crash") {
      dependencies.updateTask(request.cwd, attempt.taskId, {
        status: "blocked",
        assigned_to: undefined,
        current_attempt_id: undefined,
        blocked_code: classification.blockedCode,
        blocked_reason: "Worker process crashed before completing the task",
      });
    }
  }

  if (firstClose) {
    removeActiveAttempt(request.cwd, request.attemptId, dependencies);
    dependencies.appendSchedulerEvent(request.cwd, closeEvent(request, attempt, classification));
  }
  return classification;
}

import type { Task } from "../types.js";
import type { SchedulerRecord, WaveTargetEntry } from "./types.js";

export interface SelectionInput {
  scheduler: SchedulerRecord;
  tasks: Task[];
  liveAssignedAttemptIds: Set<string>;
  reservedTaskIds: Set<string>;
  desiredConcurrency: number;
  maxAttemptsPerTask: number;
  dependencies: "advisory" | "strict";
}

export interface SelectionResult {
  taskIds: string[];
  unavailable: Record<string, string>;
  waveDrained: boolean;
  planTerminal: boolean;
  slots: number;
}

function authorizedTaskIds(scheduler: SchedulerRecord, tasks: Task[]): string[] {
  switch (scheduler.mode) {
    case "continuous":
      return tasks.map((task) => task.id);
    case "wave":
      return scheduler.waveSnapshotTaskIds.filter((taskId) => scheduler.waveTargetState[taskId]?.authorized);
    case "targeted":
      return scheduler.waveSnapshotTaskIds
        .filter((taskId) => scheduler.waveTargetState[taskId]?.authorized)
        .slice(0, 1);
    case "idle":
    case "paused":
      return [];
    default:
      throw new Error(`Unsupported execution mode: ${String(scheduler.mode)}`);
  }
}

type Availability =
  | { kind: "eligible" | "terminal" }
  | { kind: "outstanding"; reason: string }
  | { kind: "unavailable"; reason: string; deterministic: boolean };

export function isDeterministicUnavailableReason(reason: string): boolean {
  return reason === "max_attempts"
    || reason === "retry_not_authorized"
    || reason === "task_missing";
}

function classifyAvailability(
  taskId: string,
  input: SelectionInput,
  tasksById: Map<string, Task>,
): Availability {
  const task = tasksById.get(taskId);
  const target: WaveTargetEntry | undefined = input.scheduler.waveTargetState[taskId];
  if (target?.terminal || task?.status === "done" || task?.status === "blocked") return { kind: "terminal" };
  if (!task) return { kind: "unavailable", reason: "task_missing", deterministic: true };

  const hasActiveAttempt = task.current_attempt_id !== undefined
    && input.liveAssignedAttemptIds.has(task.current_attempt_id);
  if (hasActiveAttempt) return { kind: "outstanding", reason: "active_attempt" };
  if (task.status === "review_pending") return { kind: "outstanding", reason: "review_pending" };
  if (task.legacy_review_state?.state === "claiming") {
    return { kind: "outstanding", reason: "review_claiming" };
  }
  if (task.status === "in_progress") return { kind: "outstanding", reason: "active_attempt" };

  const reason = target?.unavailableReason
    ?? (task.attempt_count >= input.maxAttemptsPerTask ? "max_attempts" : undefined)
    ?? (task.attempt_count > 0 && target && !target.retryEligible ? "retry_not_authorized" : undefined);
  if (reason) {
    return {
      kind: "unavailable",
      reason,
      deterministic: target?.unavailableReason !== undefined || isDeterministicUnavailableReason(reason),
    };
  }
  if (input.reservedTaskIds.has(task.id)) {
    return { kind: "unavailable", reason: "reserved", deterministic: false };
  }
  if (
    input.dependencies === "strict"
    && task.depends_on.some((dependencyId) => tasksById.get(dependencyId)?.status !== "done")
  ) {
    return { kind: "unavailable", reason: "dependency_not_done", deterministic: false };
  }
  return { kind: "eligible" };
}

export function selectDispatches(input: SelectionInput): SelectionResult {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const slots = Math.max(0, Math.floor(input.desiredConcurrency) - input.liveAssignedAttemptIds.size);
  const unavailable: Record<string, string> = {};
  const eligible: Task[] = [];

  for (const taskId of authorizedTaskIds(input.scheduler, input.tasks)) {
    const availability = classifyAvailability(taskId, input, tasksById);
    if (availability.kind === "eligible") {
      const task = tasksById.get(taskId);
      if (task) eligible.push(task);
    } else if (availability.kind === "outstanding" || availability.kind === "unavailable") {
      unavailable[taskId] = availability.reason;
    }
  }

  eligible.sort((left, right) => {
    const priority = Number(left.attempt_count !== 0) - Number(right.attempt_count !== 0);
    return priority || left.id.localeCompare(right.id);
  });

  const waveDrained = (input.scheduler.mode === "wave" || input.scheduler.mode === "targeted")
    && input.scheduler.waveSnapshotTaskIds.every((taskId) => {
      const availability = classifyAvailability(taskId, input, tasksById);
      return availability.kind === "terminal"
        || (availability.kind === "unavailable" && availability.deterministic);
    });

  return {
    taskIds: eligible.slice(0, slots).map((task) => task.id),
    unavailable,
    waveDrained,
    planTerminal: input.tasks.every((task) => task.status === "done" || task.status === "blocked"),
    slots,
  };
}

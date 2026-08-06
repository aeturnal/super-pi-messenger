import { readAttempt, readSchedulerRecord } from "./store.js";
import * as taskStore from "../store.js";
import type { Task, TaskEvidence } from "../types.js";

export interface TrustedCompletionIdentity {
  taskId: string;
  attemptId: string;
  runId: string;
  controllerId: string;
}

export interface CompleteOwnedAttemptInput {
  cwd: string;
  taskId: string;
  attemptId?: string;
  summary: string;
  evidence?: TaskEvidence;
  reviewEnabled: boolean;
  completedAt?: string;
  trustedIdentity?: TrustedCompletionIdentity;
}

export type CompletionRejectionReason =
  | "missing_attempt"
  | "task_not_found"
  | "stale_attempt"
  | "foreign_attempt"
  | "closed_attempt"
  | "unowned_attempt";

export type CompletionResult =
  | { kind: "committed" | "duplicate"; task: Task }
  | { kind: "rejected"; reason: CompletionRejectionReason };

function completedBy(task: Task, attemptId: string): boolean {
  return task.completion_attempt_id === attemptId
    || task.legacy_review_state?.attemptId === attemptId;
}

function synchronizeCompletedCount(cwd: string): void {
  taskStore.autoCompleteMilestones(cwd);
  const plan = taskStore.getPlan(cwd);
  if (!plan) return;
  const completedCount = taskStore.getTasks(cwd).filter(task => task.status === "done").length;
  if (plan.completed_count !== completedCount) {
    taskStore.updatePlan(cwd, { completed_count: completedCount });
  }
}

export function completeOwnedAttempt(input: CompleteOwnedAttemptInput): CompletionResult {
  const task = taskStore.getTask(input.cwd, input.taskId);
  if (!task) return { kind: "rejected", reason: "task_not_found" };
  if (!input.attemptId) return { kind: "rejected", reason: "missing_attempt" };
  if (completedBy(task, input.attemptId)) return { kind: "duplicate", task };
  if (task.status !== "in_progress" || task.current_attempt_id !== input.attemptId) {
    return { kind: "rejected", reason: "stale_attempt" };
  }

  const attempt = readAttempt(input.cwd, input.attemptId);
  if (!attempt || attempt.taskId !== input.taskId) {
    return { kind: "rejected", reason: "foreign_attempt" };
  }
  if (attempt.state === "closed") return { kind: "rejected", reason: "closed_attempt" };

  const scheduler = readSchedulerRecord(input.cwd);
  const ownsScheduler = scheduler
    && scheduler.runId === attempt.runId
    && scheduler.controllerId === attempt.controllerId
    && scheduler.leaseEpoch === attempt.leaseEpoch
    && scheduler.activeAttemptIds.includes(attempt.attemptId);
  const trustedIdentityMatches = !input.trustedIdentity
    || (input.trustedIdentity.taskId === attempt.taskId
      && input.trustedIdentity.attemptId === attempt.attemptId
      && input.trustedIdentity.runId === attempt.runId
      && input.trustedIdentity.controllerId === attempt.controllerId);
  if (!ownsScheduler || !trustedIdentityMatches) {
    return { kind: "rejected", reason: "unowned_attempt" };
  }

  const completedAt = input.completedAt ?? new Date().toISOString();
  const updated = taskStore.updateTask(input.cwd, input.taskId, {
    status: input.reviewEnabled ? "review_pending" : "done",
    completed_at: completedAt,
    summary: input.summary,
    evidence: input.evidence,
    completion_attempt_id: input.attemptId,
    legacy_review_state: input.reviewEnabled ? {
      version: 1,
      state: "pending",
      reviewCount: task.review_count ?? task.legacy_review_state?.reviewCount ?? 0,
      attemptId: input.attemptId,
    } : undefined,
  });
  if (!updated) return { kind: "rejected", reason: "task_not_found" };

  synchronizeCompletedCount(input.cwd);
  return { kind: "committed", task: taskStore.getTask(input.cwd, input.taskId) ?? updated };
}

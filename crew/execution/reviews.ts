import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawnAgents } from "../agents.js";
import * as taskStore from "../store.js";
import type { Task } from "../types.js";
import { discoverCrewAgents } from "../utils/discover.js";
import { parseVerdict, type ParsedReview } from "../utils/verdict.js";
import { validateControllerLease } from "./lease.js";
import { readSchedulerRecord } from "./store.js";
import type { ControllerLease, LegacyReviewState, ReviewOutcome, SchedulerRecord } from "./types.js";

export interface ReviewClaim {
  taskId: string;
  attemptId: string;
  claimToken: string;
  controllerId: string;
  claimedAt: string;
}

interface LeaseBoundReviewInput {
  cwd: string;
  runId: string;
  lease: ControllerLease;
  isProcessAlive(pid: number): boolean;
}

export interface ClaimPendingReviewInput extends LeaseBoundReviewInput {
  taskId: string;
  claimedAt?: string;
}

export type ReviewClaimResult =
  | { kind: "claimed"; claim: ReviewClaim; task: Task }
  | { kind: "rejected"; reason: "invalid_lease_or_run" | "not_authorized" | "not_pending" };

export type ReviewFailureCode =
  | "review_provider_unavailable"
  | "review_provider_failed"
  | "review_malformed"
  | "review_input_missing";

export type ReviewDecision =
  | { kind: "review"; review: ParsedReview }
  | { kind: "failure"; failureCode: ReviewFailureCode; reason: string };

export interface CommitReviewOutcomeInput extends LeaseBoundReviewInput {
  claim: ReviewClaim;
  decision: ReviewDecision;
  completedAt?: string;
}

export type ReviewCommitResult =
  | { kind: "committed" | "duplicate"; task: Task }
  | { kind: "rejected"; reason: "invalid_lease_or_run" | "claim_mismatch" };

export type ClaimantLiveness = "alive" | "dead" | "unknown";

export interface RecoverDeadReviewClaimInput extends LeaseBoundReviewInput {
  taskId: string;
  claimantLiveness(controllerId: string): ClaimantLiveness;
}

export interface LegacyReviewerProviderRequest {
  cwd: string;
  taskId: string;
  prompt: string;
  model?: string;
}

export interface LegacyReviewerProviderResult {
  available: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

export type LegacyReviewerProvider = (
  request: LegacyReviewerProviderRequest,
) => Promise<LegacyReviewerProviderResult>;

export class LegacyReviewInvocationError extends Error {
  constructor(
    public readonly code: ReviewFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "LegacyReviewInvocationError";
  }
}

function schedulerOwnsLease(input: LeaseBoundReviewInput): SchedulerRecord | null {
  if (input.runId !== input.lease.planRunId) return null;
  if (!validateControllerLease(input.cwd, input.lease, { isProcessAlive: input.isProcessAlive })) {
    return null;
  }
  const scheduler = readSchedulerRecord(input.cwd);
  if (!scheduler
    || scheduler.runId !== input.runId
    || scheduler.controllerId !== input.lease.controllerId
    || scheduler.leaseEpoch !== input.lease.leaseEpoch) {
    return null;
  }
  return scheduler;
}

function reviewAuthorized(scheduler: SchedulerRecord, taskId: string): boolean {
  if (scheduler.mode === "continuous") return true;
  if (scheduler.mode !== "wave" && scheduler.mode !== "targeted") return false;
  return scheduler.waveSnapshotTaskIds.includes(taskId)
    && scheduler.waveTargetState[taskId]?.authorized === true;
}

function pendingState(task: Task): LegacyReviewState | null {
  const state = task.legacy_review_state;
  if (task.status !== "review_pending"
    || state?.state !== "pending"
    || task.completion_attempt_id !== state.attemptId) {
    return null;
  }
  return state;
}

export function claimPendingReview(input: ClaimPendingReviewInput): ReviewClaimResult {
  const scheduler = schedulerOwnsLease(input);
  if (!scheduler) return { kind: "rejected", reason: "invalid_lease_or_run" };
  if (!reviewAuthorized(scheduler, input.taskId)) {
    return { kind: "rejected", reason: "not_authorized" };
  }

  const task = taskStore.getTask(input.cwd, input.taskId);
  const state = task ? pendingState(task) : null;
  if (!task || !state) return { kind: "rejected", reason: "not_pending" };

  const claim: ReviewClaim = {
    taskId: task.id,
    attemptId: state.attemptId,
    claimToken: randomUUID(),
    controllerId: input.lease.controllerId,
    claimedAt: input.claimedAt ?? new Date().toISOString(),
  };
  const updated = taskStore.updateTask(input.cwd, task.id, {
    legacy_review_state: {
      ...state,
      state: "claiming",
      claimToken: claim.claimToken,
      claimantControllerId: claim.controllerId,
      claimedAt: claim.claimedAt,
    },
  });
  if (!updated) return { kind: "rejected", reason: "not_pending" };
  return { kind: "claimed", claim, task: updated };
}

function terminalStateFor(decision: ReviewDecision): LegacyReviewState["state"] {
  if (decision.kind === "failure") return "failed";
  const states: Record<ReviewOutcome, LegacyReviewState["state"]> = {
    SHIP: "ship",
    NEEDS_WORK: "needs_work",
    MAJOR_RETHINK: "major_rethink",
  };
  return states[decision.review.verdict];
}

function isDuplicateCommit(task: Task, input: CommitReviewOutcomeInput): boolean {
  const state = task.legacy_review_state;
  if (!state || state.state === "pending" || state.state === "claiming") return false;
  if (input.claim.taskId !== task.id
    || state.attemptId !== input.claim.attemptId
    || state.claimToken !== input.claim.claimToken
    || state.claimantControllerId !== input.claim.controllerId) {
    return false;
  }
  if (input.decision.kind === "failure") {
    return state.state === "failed" && state.failureCode === input.decision.failureCode;
  }
  return state.state === terminalStateFor(input.decision)
    && state.outcome === input.decision.review.verdict;
}

function claimMatches(task: Task, input: CommitReviewOutcomeInput): boolean {
  const state = task.legacy_review_state;
  return input.claim.taskId === task.id
    && input.claim.controllerId === input.lease.controllerId
    && task.status === "review_pending"
    && state?.state === "claiming"
    && state.attemptId === input.claim.attemptId
    && state.claimToken === input.claim.claimToken
    && state.claimantControllerId === input.claim.controllerId;
}

function reviewProgress(review: ParsedReview): string {
  return `Review: ${review.verdict} — ${review.summary.split("\n")[0].slice(0, 120)}`;
}

function completionHistory(task: Task, review: ParsedReview): string {
  const tests = task.evidence?.tests?.join(", ") || "none recorded";
  return `Prior completion for ${task.completion_attempt_id}: ${task.summary ?? "no summary"}; tests: ${tests}. ${reviewProgress(review)}`;
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

export function commitReviewOutcome(input: CommitReviewOutcomeInput): ReviewCommitResult {
  if (!schedulerOwnsLease(input)) {
    return { kind: "rejected", reason: "invalid_lease_or_run" };
  }
  const task = taskStore.getTask(input.cwd, input.claim.taskId);
  if (!task) return { kind: "rejected", reason: "claim_mismatch" };
  if (isDuplicateCommit(task, input)) return { kind: "duplicate", task };
  if (!claimMatches(task, input)) return { kind: "rejected", reason: "claim_mismatch" };

  const currentState = task.legacy_review_state;
  if (!currentState || currentState.state !== "claiming") {
    return { kind: "rejected", reason: "claim_mismatch" };
  }
  const completedAt = input.completedAt ?? new Date().toISOString();
  const reviewCount = currentState.reviewCount + 1;
  const terminalState: LegacyReviewState = {
    ...currentState,
    state: terminalStateFor(input.decision),
    completedAt,
    reviewCount,
    outcome: input.decision.kind === "review" ? input.decision.review.verdict : undefined,
    failureCode: input.decision.kind === "failure" ? input.decision.failureCode : undefined,
  };

  let updates: Partial<Task>;
  if (input.decision.kind === "failure") {
    updates = {
      status: "blocked",
      assigned_to: undefined,
      current_attempt_id: undefined,
      review_count: reviewCount,
      legacy_review_state: terminalState,
      blocked_code: input.decision.failureCode,
      blocked_reason: input.decision.reason,
    };
    taskStore.appendTaskProgress(
      input.cwd,
      task.id,
      "system",
      `Review failed (${input.decision.failureCode}): ${input.decision.reason}`,
    );
  } else {
    const review = input.decision.review;
    const lastReview = {
      verdict: review.verdict,
      summary: review.summary,
      issues: review.issues,
      suggestions: review.suggestions,
      reviewed_at: completedAt,
    };
    if (review.verdict === "SHIP") {
      updates = {
        status: "done",
        review_count: reviewCount,
        legacy_review_state: terminalState,
        last_review: lastReview,
      };
      taskStore.appendTaskProgress(input.cwd, task.id, "system", reviewProgress(review));
    } else if (review.verdict === "NEEDS_WORK") {
      taskStore.appendTaskProgress(input.cwd, task.id, "system", completionHistory(task, review));
      updates = {
        status: "todo",
        assigned_to: undefined,
        current_attempt_id: undefined,
        started_at: undefined,
        base_commit: undefined,
        completed_at: undefined,
        completion_attempt_id: undefined,
        summary: undefined,
        evidence: undefined,
        review_count: reviewCount,
        legacy_review_state: terminalState,
        last_review: lastReview,
      };
    } else {
      updates = {
        status: "blocked",
        assigned_to: undefined,
        current_attempt_id: undefined,
        review_count: reviewCount,
        legacy_review_state: terminalState,
        last_review: lastReview,
        blocked_reason: `Reviewer: ${review.summary.split("\n")[0].slice(0, 120)}`,
      };
      taskStore.appendTaskProgress(input.cwd, task.id, "system", reviewProgress(review));
    }
  }

  const updated = taskStore.updateTask(input.cwd, task.id, updates);
  if (!updated) return { kind: "rejected", reason: "claim_mismatch" };
  synchronizeCompletedCount(input.cwd);
  return { kind: "committed", task: taskStore.getTask(input.cwd, task.id) ?? updated };
}

export function recoverDeadReviewClaim(input: RecoverDeadReviewClaimInput): boolean {
  if (!schedulerOwnsLease(input)) return false;
  const task = taskStore.getTask(input.cwd, input.taskId);
  const state = task?.legacy_review_state;
  if (!task || task.status !== "review_pending" || state?.state !== "claiming") return false;
  const claimantControllerId = state.claimantControllerId;
  if (!claimantControllerId || claimantControllerId === input.lease.controllerId) return false;
  if (input.claimantLiveness(claimantControllerId) !== "dead") return false;

  return taskStore.updateTask(input.cwd, input.taskId, {
    legacy_review_state: {
      version: 1,
      state: "pending",
      reviewCount: state.reviewCount,
      attemptId: state.attemptId,
    },
  }) !== null;
}

const defaultProvider: LegacyReviewerProvider = async request => {
  const available = discoverCrewAgents(request.cwd).some(agent => agent.name === "crew-reviewer");
  if (!available) return { available: false, exitCode: 1, output: "" };
  const [review] = await spawnAgents([{
    agent: "crew-reviewer",
    task: request.prompt,
    modelOverride: request.model,
  }], request.cwd);
  return {
    available: true,
    exitCode: review.exitCode,
    output: review.output,
    error: review.error,
  };
};

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
}

export async function invokeLegacyReviewer(
  cwd: string,
  taskId: string,
  model?: string,
  provider: LegacyReviewerProvider = defaultProvider,
): Promise<ParsedReview> {
  const task = taskStore.getTask(cwd, taskId);
  if (!task?.base_commit) {
    throw new LegacyReviewInvocationError(
      "review_input_missing",
      `Task ${taskId} is missing a base commit required for review`,
    );
  }

  let diff: string;
  let commitLog: string;
  try {
    diff = gitOutput(cwd, ["diff", task.base_commit, "--"]);
    commitLog = gitOutput(cwd, ["log", "--oneline", `${task.base_commit}..HEAD`]);
  } catch (error) {
    throw new LegacyReviewInvocationError(
      "review_input_missing",
      `Could not load review inputs for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const taskSpec = taskStore.getTaskSpec(cwd, taskId) ?? "";
  const plan = taskStore.getPlan(cwd);
  const prompt = `# Code Review Request\n\n## Task Information\n\n**Task ID:** ${taskId}\n**Task Title:** ${task.title}\n**PRD:** ${plan?.prd ?? "Unknown"}\n\n## Task Specification\n\n${taskSpec || "*No spec available*"}\n\n## Changes\n\n### Commits\n${commitLog || "*No commits*"}\n\n### Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n## Your Review\n\nReview this implementation following the crew-reviewer protocol.\nOutput your verdict as SHIP, NEEDS_WORK, or MAJOR_RETHINK with detailed feedback.`;

  let result: LegacyReviewerProviderResult;
  try {
    result = await provider({ cwd, taskId, prompt, model });
  } catch (error) {
    throw new LegacyReviewInvocationError(
      "review_provider_failed",
      `Reviewer provider failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!result.available) {
    throw new LegacyReviewInvocationError("review_provider_unavailable", "crew-reviewer provider is unavailable");
  }
  if (result.exitCode !== 0) {
    throw new LegacyReviewInvocationError(
      "review_provider_failed",
      `Reviewer provider failed: ${result.error ?? `exit code ${result.exitCode}`}`,
    );
  }
  if (!/##\s*Verdict:\s*(SHIP|NEEDS_WORK|MAJOR_RETHINK)\b/i.test(result.output)) {
    throw new LegacyReviewInvocationError(
      "review_malformed",
      "Reviewer output did not contain a valid SHIP, NEEDS_WORK, or MAJOR_RETHINK verdict",
    );
  }
  return parseVerdict(result.output);
}

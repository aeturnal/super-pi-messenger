import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acquireControllerLease } from "../../crew/execution/lease.js";
import {
  claimPendingReview,
  commitReviewOutcome,
  invokeLegacyReviewer,
  LegacyReviewInvocationError,
  recoverDeadReviewClaim,
  type ClaimPendingReviewInput,
  type CommitReviewOutcomeInput,
  type ReviewClaim,
} from "../../crew/execution/reviews.js";
import { selectDispatches } from "../../crew/execution/selection.js";
import { writeSchedulerRecord } from "../../crew/execution/store.js";
import type { ControllerLease, ReviewOutcome, SchedulerRecord } from "../../crew/execution/types.js";
import { reviewImplementation } from "../../crew/handlers/review.js";
import * as store from "../../crew/store.js";
import type { Task } from "../../crew/types.js";
import type { ParsedReview } from "../../crew/utils/verdict.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const later = "2026-07-28T12:05:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const attemptA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Harness = {
  cwd: string;
  task: Task;
  lease: ControllerLease;
  live: (pid: number) => boolean;
};

function scheduler(lease: ControllerLease, mode: SchedulerRecord["mode"] = "continuous"): SchedulerRecord {
  return {
    version: 1,
    runId,
    controllerId: lease.controllerId,
    leaseEpoch: lease.leaseEpoch,
    mode,
    waveSnapshotTaskIds: mode === "wave" ? ["task-1"] : [],
    waveTargetState: mode === "wave" ? {
      "task-1": { authorized: true, retryEligible: true, terminal: false },
    } : {},
    desiredConcurrencyOverride: null,
    activeAttemptIds: [],
    cancellationIntent: null,
  };
}

function createHarness(mode: SchedulerRecord["mode"] = "continuous"): Harness {
  const { cwd } = createTempCrewDirs();
  store.createPlan(cwd, "PRD.md");
  store.updatePlan(cwd, { run_id: runId });
  const task = store.createTask(cwd, "Review me", "Implementation spec");
  store.updateTask(cwd, task.id, {
    status: "review_pending",
    assigned_to: "worker-a",
    current_attempt_id: attemptA,
    completion_attempt_id: attemptA,
    attempt_count: 1,
    completed_at: now,
    summary: "Implemented the feature",
    evidence: { tests: ["npx vitest run"] },
    base_commit: "base-commit",
    legacy_review_state: {
      version: 1,
      state: "pending",
      reviewCount: 0,
      attemptId: attemptA,
    },
  });
  const live = (pid: number) => pid === 101;
  const acquired = acquireControllerLease(cwd, runId, "controller-a", {
    pid: 101,
    now: () => now,
    isProcessAlive: live,
  });
  if (!acquired.acquired) throw new Error("expected test lease");
  writeSchedulerRecord(cwd, scheduler(acquired.lease, mode));
  return { cwd, task: store.getTask(cwd, task.id)!, lease: acquired.lease, live };
}

function claimInput(harness: Harness): ClaimPendingReviewInput {
  return {
    cwd: harness.cwd,
    taskId: harness.task.id,
    runId,
    lease: harness.lease,
    claimedAt: now,
    isProcessAlive: harness.live,
  };
}

function parsed(verdict: ReviewOutcome): ParsedReview {
  return {
    verdict,
    summary: `${verdict} summary`,
    issues: verdict === "SHIP" ? [] : ["Issue one"],
    suggestions: verdict === "SHIP" ? [] : ["Suggestion one"],
  };
}

function commitInput(
  harness: Harness,
  claim: ReviewClaim,
  outcome: ReviewOutcome,
): CommitReviewOutcomeInput {
  return {
    cwd: harness.cwd,
    runId,
    lease: harness.lease,
    claim,
    decision: { kind: "review", review: parsed(outcome) },
    completedAt: later,
    isProcessAlive: harness.live,
  };
}

function claimOrThrow(harness: Harness): ReviewClaim {
  const result = claimPendingReview(claimInput(harness));
  if (result.kind !== "claimed") throw new Error(`claim rejected: ${result.reason}`);
  return result.claim;
}

function replaceSchedulerMode(harness: Harness, mode: SchedulerRecord["mode"]): void {
  writeSchedulerRecord(harness.cwd, scheduler(harness.lease, mode));
}

function takeoverDeadClaim(harness: Harness): Harness {
  const takeover = acquireControllerLease(harness.cwd, runId, "controller-b", {
    pid: 202,
    now: () => later,
    isProcessAlive: pid => pid === 202,
  });
  if (!takeover.acquired) throw new Error("expected lease takeover");
  writeSchedulerRecord(harness.cwd, scheduler(takeover.lease, "continuous"));
  return { ...harness, lease: takeover.lease, live: pid => pid === 202 };
}

describe("durable legacy review claims", () => {
  it.each([
    ["SHIP", "done", "ship"],
    ["NEEDS_WORK", "todo", "needs_work"],
    ["MAJOR_RETHINK", "blocked", "major_rethink"],
  ] as const)("commits %s exactly once", (outcome, taskStatus, reviewState) => {
    const harness = createHarness();
    const claim = claimOrThrow(harness);

    const first = commitReviewOutcome(commitInput(harness, claim, outcome));
    const duplicate = commitReviewOutcome(commitInput(harness, claim, outcome));

    expect(first.kind).toBe("committed");
    expect(duplicate.kind).toBe("duplicate");
    expect(store.getTask(harness.cwd, harness.task.id)).toMatchObject({
      status: taskStatus,
      review_count: 1,
      last_review: { verdict: outcome, summary: `${outcome} summary` },
      legacy_review_state: {
        state: reviewState,
        reviewCount: 1,
        attemptId: attemptA,
        claimToken: claim.claimToken,
        claimantControllerId: claim.controllerId,
      },
    });
    expect(store.getPlan(harness.cwd)?.completed_count).toBe(outcome === "SHIP" ? 1 : 0);
  });

  it.each([
    ["provider unavailable", "review_provider_unavailable"],
    ["provider failed", "review_provider_failed"],
    ["malformed verdict", "review_malformed"],
    ["missing review input", "review_input_missing"],
  ] as const)("commits %s as a durable actionable failure", (reason, failureCode) => {
    const harness = createHarness();
    const claim = claimOrThrow(harness);

    const result = commitReviewOutcome({
      ...commitInput(harness, claim, "SHIP"),
      decision: { kind: "failure", failureCode, reason: `Action required: ${reason}` },
    });

    expect(result.kind).toBe("committed");
    expect(store.getTask(harness.cwd, harness.task.id)).toMatchObject({
      status: "blocked",
      blocked_code: failureCode,
      blocked_reason: `Action required: ${reason}`,
      legacy_review_state: { state: "failed", failureCode, attemptId: attemptA },
    });
  });

  const mismatchCases: Array<{
    label: string;
    claimOverrides?: Partial<ReviewClaim>;
    overrideRunId?: string;
    leaseControllerId?: string;
  }> = [
    { label: "claim token", claimOverrides: { claimToken: "wrong-token" } },
    { label: "claim controller", claimOverrides: { controllerId: "controller-b" } },
    { label: "claim attempt", claimOverrides: { attemptId: attemptB } },
    { label: "run", overrideRunId: "22222222-2222-4222-8222-222222222222" },
    { label: "lease", leaseControllerId: "controller-b" },
  ];

  it.each(mismatchCases)("rejects a $label mismatch without mutation", ({
    claimOverrides = {}, overrideRunId, leaseControllerId,
  }) => {
    const harness = createHarness();
    const claim = claimOrThrow(harness);
    const before = store.getTask(harness.cwd, harness.task.id);
    const lease = leaseControllerId
      ? { ...harness.lease, controllerId: leaseControllerId }
      : harness.lease;

    const result = commitReviewOutcome({
      ...commitInput(harness, { ...claim, ...claimOverrides }, "SHIP"),
      ...(overrideRunId ? { runId: overrideRunId } : {}),
      lease,
    });

    expect(result.kind).toBe("rejected");
    expect(store.getTask(harness.cwd, harness.task.id)).toEqual(before);
  });

  it("allows a live claimant to finish after pause but starts no claim while paused", () => {
    const harness = createHarness();
    const claim = claimOrThrow(harness);
    replaceSchedulerMode(harness, "paused");

    expect(commitReviewOutcome(commitInput(harness, claim, "SHIP"))).toMatchObject({ kind: "committed" });

    const second = createHarness("paused");
    expect(claimPendingReview(claimInput(second))).toMatchObject({
      kind: "rejected",
      reason: "not_authorized",
    });
    expect(store.getTask(second.cwd, second.task.id)?.legacy_review_state?.state).toBe("pending");
  });

  it("recovers a claim only after the old claimant is proven dead", () => {
    const harness = createHarness();
    const claim = claimOrThrow(harness);

    expect(recoverDeadReviewClaim({
      cwd: harness.cwd,
      taskId: harness.task.id,
      runId,
      lease: harness.lease,
      isProcessAlive: harness.live,
      claimantLiveness: () => "alive",
    })).toBe(false);
    expect(recoverDeadReviewClaim({
      cwd: harness.cwd,
      taskId: harness.task.id,
      runId,
      lease: harness.lease,
      isProcessAlive: harness.live,
      claimantLiveness: () => "unknown",
    })).toBe(false);
    expect(store.getTask(harness.cwd, harness.task.id)?.legacy_review_state).toMatchObject({
      state: "claiming",
      claimToken: claim.claimToken,
    });

    const takeover = takeoverDeadClaim(harness);
    expect(recoverDeadReviewClaim({
      cwd: takeover.cwd,
      taskId: takeover.task.id,
      runId,
      lease: takeover.lease,
      isProcessAlive: takeover.live,
      claimantLiveness: (controllerId: string) => controllerId === "controller-a" ? "dead" : "alive",
    })).toBe(true);
    expect(store.getTask(harness.cwd, harness.task.id)?.legacy_review_state).toMatchObject({
      state: "pending",
      reviewCount: 0,
      attemptId: attemptA,
    });
    expect(store.getTask(harness.cwd, harness.task.id)?.legacy_review_state?.claimToken).toBeUndefined();
  });

  it("reclaims with a fresh token after a crash before invocation", async () => {
    const harness = createHarness();
    const firstClaim = claimOrThrow(harness);
    const provider = vi.fn(async () => parsed("SHIP"));
    const takeover = takeoverDeadClaim(harness);

    expect(recoverDeadReviewClaim({
      cwd: takeover.cwd,
      taskId: takeover.task.id,
      runId,
      lease: takeover.lease,
      isProcessAlive: takeover.live,
      claimantLiveness: () => "dead",
    })).toBe(true);
    const secondClaim = claimOrThrow(takeover);
    await provider();

    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("invokes at least once again after a crash between invocation and commit", async () => {
    const harness = createHarness();
    claimOrThrow(harness);
    const provider = vi.fn(async () => parsed("SHIP"));
    await provider();
    const takeover = takeoverDeadClaim(harness);

    expect(recoverDeadReviewClaim({
      cwd: takeover.cwd,
      taskId: takeover.task.id,
      runId,
      lease: takeover.lease,
      isProcessAlive: takeover.live,
      claimantLiveness: () => "dead",
    })).toBe(true);
    const secondClaim = claimOrThrow(takeover);
    const secondReview = await provider();
    expect(commitReviewOutcome({
      ...commitInput(takeover, secondClaim, "SHIP"),
      decision: { kind: "review", review: secondReview },
    })).toMatchObject({ kind: "committed" });

    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("preserves prior evidence for NEEDS_WORK and rejects late old-attempt writes", () => {
    const harness = createHarness("wave");
    const claim = claimOrThrow(harness);
    expect(commitReviewOutcome(commitInput(harness, claim, "NEEDS_WORK"))).toMatchObject({ kind: "committed" });

    const progress = store.getTaskProgress(harness.cwd, harness.task.id) ?? "";
    expect(progress).toContain("Implemented the feature");
    expect(progress).toContain("npx vitest run");
    expect(progress).toContain("NEEDS_WORK summary");
    const retry = store.getTask(harness.cwd, harness.task.id)!;
    expect(retry).toMatchObject({ status: "todo", attempt_count: 1 });
    expect(retry.assigned_to).toBeUndefined();
    expect(retry.current_attempt_id).toBeUndefined();
    expect(retry.completion_attempt_id).toBeUndefined();

    const selectionInput = {
      scheduler: scheduler(harness.lease, "wave"),
      tasks: [retry],
      liveAssignedAttemptIds: new Set<string>(),
      reservedTaskIds: new Set<string>(),
      desiredConcurrency: 1,
      maxAttemptsPerTask: 2,
      dependencies: "strict" as const,
    };
    expect(selectDispatches(selectionInput).taskIds).toEqual([retry.id]);
    expect(selectDispatches({ ...selectionInput, maxAttemptsPerTask: 1 })).toMatchObject({
      taskIds: [], unavailable: { [retry.id]: "max_attempts" },
    });
    expect(selectDispatches({
      ...selectionInput,
      scheduler: scheduler(harness.lease, "paused"),
    }).taskIds).toEqual([]);

    store.updateTask(harness.cwd, harness.task.id, {
      status: "in_progress",
      assigned_to: "worker-b",
      current_attempt_id: attemptB,
      attempt_count: 2,
    });
    const beforeLateWrite = store.getTask(harness.cwd, harness.task.id);
    expect(commitReviewOutcome(commitInput(harness, claim, "NEEDS_WORK"))).toMatchObject({ kind: "duplicate" });
    expect(store.getTask(harness.cwd, harness.task.id)).toEqual(beforeLateWrite);
  });

  it("fails closed while paused, then claims only after explicit authorization", async () => {
    const harness = createHarness("paused");
    const provider = vi.fn(async () => parsed("SHIP"));

    expect(claimPendingReview(claimInput(harness))).toMatchObject({ kind: "rejected", reason: "not_authorized" });
    expect(provider).not.toHaveBeenCalled();

    replaceSchedulerMode(harness, "continuous");
    const claim = claimOrThrow(harness);
    await provider();
    expect(claim.attemptId).toBe(attemptA);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe("legacy reviewer provider adapter", () => {
  function seedGitReview(): { cwd: string; taskId: string } {
    const { cwd } = createTempCrewDirs();
    execSync("git init -q && git config user.email test@example.com && git config user.name Test", { cwd });
    fs.writeFileSync(path.join(cwd, "file.txt"), "base\n");
    execSync("git add file.txt && git commit -qm base", { cwd });
    const baseCommit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(cwd, "file.txt"), "base\nchange\n");
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "Provider review", "Review this change");
    store.updateTask(cwd, task.id, { status: "review_pending", base_commit: baseCommit });
    return { cwd, taskId: task.id };
  }

  it("returns parsed provider output without mutating task persistence", async () => {
    const { cwd, taskId } = seedGitReview();
    const before = store.getTask(cwd, taskId);
    const provider = vi.fn(async () => ({
      available: true,
      exitCode: 0,
      output: "## Verdict: SHIP\nLooks good.\n## Issues\n",
    }));

    const review = await invokeLegacyReviewer(cwd, taskId, "review-model", provider);

    expect(review).toMatchObject({ verdict: "SHIP", summary: "Looks good." });
    expect(store.getTask(cwd, taskId)).toEqual(before);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("routes the legacy implementation handler through the provider-only adapter", async () => {
    const { cwd, taskId } = seedGitReview();
    const before = store.getTask(cwd, taskId);
    const provider = vi.fn(async () => ({
      available: true,
      exitCode: 0,
      output: "## Verdict: SHIP\nHandler review passed.\n",
    }));

    const response = await reviewImplementation(cwd, taskId, "review-model", provider);

    expect(response.details).toMatchObject({ verdict: "SHIP", taskId });
    expect(store.getTask(cwd, taskId)).toEqual(before);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unavailable", { available: false, exitCode: 1, output: "" }, "review_provider_unavailable"],
    ["nonzero", { available: true, exitCode: 1, output: "", error: "provider crashed" }, "review_provider_failed"],
    ["malformed", { available: true, exitCode: 0, output: "Looks fine" }, "review_malformed"],
  ] as const)("classifies %s provider results", async (_label, providerResult, failureCode) => {
    const { cwd, taskId } = seedGitReview();

    await expect(invokeLegacyReviewer(cwd, taskId, undefined, async () => providerResult))
      .rejects.toMatchObject({ code: failureCode });
  });

  it("classifies missing durable review inputs", async () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "No base commit");
    const provider = vi.fn();

    await expect(invokeLegacyReviewer(cwd, task.id, undefined, provider))
      .rejects.toBeInstanceOf(LegacyReviewInvocationError);
    await expect(invokeLegacyReviewer(cwd, task.id, undefined, provider))
      .rejects.toMatchObject({ code: "review_input_missing" });
    expect(provider).not.toHaveBeenCalled();
  });
});

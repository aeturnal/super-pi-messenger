# Durable Provider Failure Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an autonomous Crew Work run after a durable provider failure while leaving the affected task in `todo` for a later explicit retry.

**Architecture:** Preserve the durable classification already produced at the process seam by carrying it through the existing `AgentResult` interface. The Work lifecycle handles that semantic result directly, records the current wave, and stops autonomous continuation with a specific reason; it does not repeat string classification or add persistent pause state.

**Tech Stack:** TypeScript, Node.js child processes, Vitest, Pi Messenger Crew task store and activity feed.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-07-durable-provider-failure-stop-design.md`.
- Keep the affected task in `todo` and clear `assigned_to`.
- Do not apply maximum-attempt blocking to a durable provider failure.
- Process every result already running in the current wave.
- Preserve automatic review of successful tasks in that wave.
- Preserve the existing rule that durable `task.done` wins over a later nonzero process exit.
- Temporary throttling and ordinary worker failures retain existing retry behavior.
- The existing `getTerminalProviderError` implementation remains the only durable-error classifier.
- Do not add a scheduler, general pause framework, persistent pause state, background service, dependency, or new production module.
- Use the existing fresh-worker and lobby-worker process seams.

---

## File Structure

- Modify `crew/types.ts`: carry the durable provider result through `AgentResult`.
- Modify `crew/agents.ts`: populate the result field for fresh workers.
- Modify `crew/lobby.ts`: populate the same field for lobby workers.
- Modify `crew/state-autonomous.ts`: represent the explicit stop reason.
- Modify `crew/handlers/work.ts`: preserve retryable task state, report the failure, and stop continuation.
- Modify `tests/crew/agent-events.test.ts`: verify fresh-worker result propagation.
- Modify `tests/crew/lobby.test.ts`: verify lobby-worker result propagation.
- Create `tests/crew/durable-provider-work.test.ts`: focused Work lifecycle regression coverage.

## Task 1: Preserve Durable Provider Failure Across the Process Seam

**Files:**

- Modify: `crew/types.ts:172-188`
- Modify: `crew/agents.ts:370-426`
- Modify: `crew/lobby.ts:235-279`
- Test: `tests/crew/agent-events.test.ts:93-173`
- Test: `tests/crew/lobby.test.ts:411-438`

**Interfaces:**

- Consumes: `getTerminalProviderError(event: PiEvent): string | null`
- Produces: `AgentResult.terminalProviderError?: string`
- Invariant: `terminalProviderError` is present only when the existing classifier returned a durable provider failure.

- [ ] **Step 1: Add failing fresh-worker result assertions**

In the existing durable quota and credential table tests in `tests/crew/agent-events.test.ts`, assert that the semantic field matches the existing error:

```ts
expect(result.error).toContain("Provider error 400");
expect(result.terminalProviderError).toBe(result.error);
```

For the credential table, use:

```ts
expect(result.error).toContain(errorMessage);
expect(result.terminalProviderError).toBe(result.error);
```

In the existing temporary-rate-limit test, after the process completes normally, add:

```ts
expect(result.terminalProviderError).toBeUndefined();
```

- [ ] **Step 2: Add the failing lobby-worker result assertion**

Extend the durable lobby result matcher in `tests/crew/lobby.test.ts`:

```ts
await expect(resultPromise).resolves.toMatchObject({
  taskId: "task-provider-error",
  exitCode: 1,
  error: "Provider error 400: 400: quota exhausted. Add more credits to continue.",
  terminalProviderError: "Provider error 400: 400: quota exhausted. Add more credits to continue.",
});
```

The existing temporary lobby test must continue to show that the process is not killed. If it later resolves a result in the test, assert `terminalProviderError` is absent; do not change its current keep-alive contract solely to obtain a result.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
```

Expected: FAIL because `AgentResult` does not yet return `terminalProviderError`.

- [ ] **Step 4: Extend the result interface**

Add the optional field in `crew/types.ts` immediately after `error?: string`:

```ts
export interface AgentResult {
  agent: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  progress: AgentProgress;
  config?: CrewAgentConfig;
  taskId?: string;
  wasGracefullyShutdown?: boolean;
  error?: string;
  terminalProviderError?: string;
  artifactPaths?: {
    input: string;
    output: string;
    jsonl: string;
    metadata: string;
  };
}
```

- [ ] **Step 5: Populate the fresh-worker result**

In the result object resolved by `crew/agents.ts`, preserve the local classifier result without reclassifying the error:

```ts
resolve({
  agent: task.agent,
  exitCode,
  output: truncation.text,
  truncated: truncation.truncated,
  progress,
  config: agentConfig,
  taskId: task.taskId,
  wasGracefullyShutdown: gracefulShutdownRequested,
  error: progress.error,
  terminalProviderError: terminalProviderError ?? undefined,
  artifactPaths: artifactPaths ? {
    input: artifactPaths.inputPath,
    output: artifactPaths.outputPath,
    jsonl: artifactPaths.jsonlPath,
    metadata: artifactPaths.metadataPath,
  } : undefined,
});
```

- [ ] **Step 6: Populate the lobby-worker result**

In `crew/lobby.ts`, add the same semantic field to `worker.resolveCompletion`:

```ts
worker.resolveCompletion({
  agent: "crew-worker",
  taskId: worker.assignedTaskId ?? undefined,
  exitCode: finalExitCode,
  output: "",
  truncated: false,
  progress,
  error: terminalProviderError ?? undefined,
  terminalProviderError: terminalProviderError ?? undefined,
});
```

- [ ] **Step 7: Run focused tests and TypeScript**

Run:

```bash
npm test -- --run tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

Expected: both commands pass.

- [ ] **Step 8: Commit the process-seam change**

```bash
git add crew/types.ts crew/agents.ts crew/lobby.ts tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
git commit -m "fix: preserve durable provider worker failures"
```

## Task 2: Stop Autonomous Continuation and Keep the Task Retryable

**Files:**

- Create: `tests/crew/durable-provider-work.test.ts`
- Modify: `crew/state-autonomous.ts:8-63`
- Modify: `crew/handlers/work.ts:73-92,341-608`

**Interfaces:**

- Consumes: `AgentResult.terminalProviderError?: string`
- Produces: `AutonomousState.stopReason` value `"provider_failure"`
- Produces: Work response detail `providerFailures: Array<{ taskId: string; error: string }>`
- Produces: autonomous entry `crew_wave_provider_failure` with `prd`, `status`, and `failures`
- Invariant: a durable failure leaves the task `todo`, clears ownership, and prevents `crew_wave_continue`.

- [ ] **Step 1: Create the focused Work test harness**

Create `tests/crew/durable-provider-work.test.ts` with the same local helpers used by other Work lifecycle tests:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { autonomousState, startAutonomous } from "../../crew/state.ts";
import { createProgress } from "../../crew/utils/progress.ts";
import { readFeedEvents } from "../../feed.ts";

function writeWorkerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-worker
description: Test worker
crewRole: worker
---
You are a worker.
`);
}

function writeReviewerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-reviewer.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-reviewer
description: Test reviewer
crewRole: reviewer
---
You are a reviewer.
`);
}

function createDirs(cwd: string) {
  const base = path.join(cwd, ".pi", "messenger");
  const registry = path.join(base, "registry");
  const inbox = path.join(base, "inbox");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  return { base, registry, inbox };
}

function resetAutonomousState(): void {
  autonomousState.active = false;
  autonomousState.cwd = null;
  autonomousState.waveNumber = 0;
  autonomousState.waveHistory = [];
  autonomousState.startedAt = null;
  autonomousState.stoppedAt = null;
  autonomousState.stopReason = null;
  autonomousState.concurrency = 2;
  autonomousState.autoOverlayPending = false;
  autonomousState.pid = null;
}

function failedResult(taskId: string, terminalProviderError?: string) {
  return {
    agent: "crew-worker",
    exitCode: 1,
    output: "",
    truncated: false,
    progress: createProgress("crew-worker"),
    taskId,
    error: terminalProviderError ?? "ordinary crash",
    terminalProviderError,
  };
}

vi.mock("../../crew/agents.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../../crew/agents.ts")>();
  return { ...actual, spawnAgents: vi.fn() };
});

describe("durable provider failure Work policy", () => {
  let dirs: TempCrewDirs;

  beforeEach(() => {
    dirs = createTempCrewDirs();
    vi.clearAllMocks();
    resetAutonomousState();
    writeWorkerAgent(dirs.cwd);
  });
});
```

Use dynamic imports inside each test after setup, matching existing Crew tests and avoiding stale module state.

- [ ] **Step 2: Add the failing durable quota and credential policy test**

Add a table-driven test for these exact messages:

```ts
it.each([
  "Provider error 429: quota has been exhausted for this account",
  "Provider error 401: Invalid API key",
])("stops autonomous work and keeps the task retryable: %s", async error => {
  const store = await import("../../crew/store.ts");
  const agents = await import("../../crew/agents.ts");
  const work = await import("../../crew/handlers/work.ts");
  const appendEntry = vi.fn();

  fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
    artifacts: { enabled: false },
    review: { enabled: false },
    work: { maxAttemptsPerTask: 1 },
  }));
  store.createPlan(dirs.cwd, "docs/PRD.md");
  const task = store.createTask(dirs.cwd, "Provider task", "Call the provider");
  vi.mocked(agents.spawnAgents).mockResolvedValue([failedResult(task.id, error)]);
  startAutonomous(dirs.cwd, 1);

  const response = await work.execute(
    { action: "work", autonomous: true, concurrency: 1 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    appendEntry,
  );

  expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
    status: "todo",
    attempt_count: 1,
  });
  expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
  expect(autonomousState.active).toBe(false);
  expect(autonomousState.stopReason).toBe("provider_failure");
  expect(response.content[0].text).toContain("Autonomous work stopped");
  expect(response.content[0].text).toContain(error);
  expect(response.content[0].text).not.toContain("Continuing to next wave");
  expect(response.details.providerFailures).toEqual([{ taskId: task.id, error }]);
  expect(appendEntry).toHaveBeenCalledWith("crew_wave_provider_failure", {
    prd: "docs/PRD.md",
    status: "provider_failure",
    failures: [{ taskId: task.id, error }],
  });
  expect(appendEntry).not.toHaveBeenCalledWith("crew_wave_continue", expect.anything());

  const progress = fs.readFileSync(
    path.join(dirs.crewDir, "tasks", `${task.id}.progress.md`),
    "utf-8",
  );
  expect(progress).toContain(error);
  expect(readFeedEvents(dirs.cwd, 20)).toContainEqual(expect.objectContaining({
    type: "task.reset",
    target: task.id,
    preview: "Provider requires user action",
  }));
});
```

The `maxAttemptsPerTask: 1` assertion proves the durable path bypasses ordinary attempt-limit blocking.

- [ ] **Step 3: Add failing retry-preservation tests**

Add one ordinary failure test with the complete setup:

```ts
it("keeps ordinary failures on the existing maximum-attempt path", async () => {
  const store = await import("../../crew/store.ts");
  const agents = await import("../../crew/agents.ts");
  const work = await import("../../crew/handlers/work.ts");

  fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
    artifacts: { enabled: false },
    review: { enabled: false },
    work: { maxAttemptsPerTask: 1 },
  }));
  store.createPlan(dirs.cwd, "docs/PRD.md");
  const task = store.createTask(dirs.cwd, "Ordinary task", "Fail ordinarily");
  vi.mocked(agents.spawnAgents).mockResolvedValue([failedResult(task.id)]);
  startAutonomous(dirs.cwd, 1);

  const response = await work.execute(
    { action: "work", autonomous: true, concurrency: 1 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    () => {},
  );

  expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
    status: "blocked",
    blocked_reason: "Max attempts (1) reached",
  });
  expect(response.details.providerFailures).toEqual([]);
  expect(autonomousState.stopReason).toBe("blocked");
});
```

Add an explicit-retry test using two Work calls:

```ts
it("allows a later explicit Work call to attempt the task again", async () => {
  const store = await import("../../crew/store.ts");
  const agents = await import("../../crew/agents.ts");
  const work = await import("../../crew/handlers/work.ts");
  const error = "Provider error 401: Invalid API key";

  fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
    artifacts: { enabled: false },
    review: { enabled: false },
    work: { maxAttemptsPerTask: 5 },
  }));
  store.createPlan(dirs.cwd, "docs/PRD.md");
  const task = store.createTask(dirs.cwd, "Retry task", "Retry after credentials are fixed");
  vi.mocked(agents.spawnAgents)
    .mockResolvedValueOnce([failedResult(task.id, error)])
    .mockResolvedValueOnce([failedResult(task.id)]);
  startAutonomous(dirs.cwd, 1);

  await work.execute(
    { action: "work", autonomous: true, concurrency: 1 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    () => {},
  );
  expect(store.getTask(dirs.cwd, task.id)?.status).toBe("todo");

  await work.execute(
    { action: "work", concurrency: 1 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    () => {},
  );

  expect(agents.spawnAgents).toHaveBeenCalledTimes(2);
  expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
    status: "todo",
    attempt_count: 2,
  });
});
```

Temporary 429 classification remains covered at the process seam in Task 1. The Work test uses absence of `terminalProviderError`, not duplicate classifier strings, to prove ordinary retry policy.

- [ ] **Step 4: Add a failing mixed-wave automatic-review test**

Add this focused coexistence test:

```ts
it("reviews current-wave successes before stopping for a durable failure", async () => {
  const store = await import("../../crew/store.ts");
  const agents = await import("../../crew/agents.ts");
  const discover = await import("../../crew/utils/discover.ts");
  const review = await import("../../crew/handlers/review.ts");
  const work = await import("../../crew/handlers/work.ts");
  const error = "Provider error 429: quota has been exhausted for this account";

  writeReviewerAgent(dirs.cwd);
  fs.writeFileSync(path.join(dirs.crewDir, "config.json"), JSON.stringify({
    artifacts: { enabled: false },
    review: { enabled: true, maxIterations: 3 },
  }));
  store.createPlan(dirs.cwd, "docs/PRD.md");
  const successfulTask = store.createTask(dirs.cwd, "Successful task", "Complete and review");
  const failedTask = store.createTask(dirs.cwd, "Provider task", "Stop after provider failure");
  vi.spyOn(discover, "discoverCrewAgents").mockReturnValue([
    { name: "crew-worker" },
    { name: "crew-reviewer" },
  ] as never);
  const reviewSpy = vi.spyOn(review, "reviewImplementation").mockResolvedValue({
    details: { verdict: "SHIP" },
  } as never);
  vi.mocked(agents.spawnAgents).mockImplementation(async tasks => tasks.map(workerTask => {
    if (workerTask.taskId === successfulTask.id) {
      store.startTask(dirs.cwd, successfulTask.id, "crew-worker");
      store.updateTask(dirs.cwd, successfulTask.id, { base_commit: "abc123" });
      store.completeTask(dirs.cwd, successfulTask.id, "Done");
      return {
        agent: "crew-worker",
        exitCode: 0,
        output: "",
        truncated: false,
        progress: createProgress("crew-worker"),
        taskId: successfulTask.id,
      };
    }
    return failedResult(failedTask.id, error);
  }));
  startAutonomous(dirs.cwd, 2);

  await work.execute(
    { action: "work", autonomous: true, concurrency: 2 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    () => {},
  );

  expect(reviewSpy).toHaveBeenCalledWith(dirs.cwd, successfulTask.id, undefined);
  expect(store.getTask(dirs.cwd, successfulTask.id)?.status).toBe("done");
  expect(store.getTask(dirs.cwd, failedTask.id)?.status).toBe("todo");
  expect(autonomousState.stopReason).toBe("provider_failure");
});
```

- [ ] **Step 5: Run the Work tests and verify RED**

Run:

```bash
npm test -- --run tests/crew/durable-provider-work.test.ts
```

Expected failures:

- `AgentResult.terminalProviderError` is treated as an ordinary failure.
- The task blocks at the attempt limit.
- `provider_failure` is not an accepted stop reason.
- `crew_wave_continue` is emitted instead of the provider-failure stop entry.
- The response has no `providerFailures` detail or stop explanation.

- [ ] **Step 6: Extend the autonomous stop-reason interface**

In `crew/state-autonomous.ts`, define and reuse one stop-reason type:

```ts
export type AutonomousStopReason =
  | "completed"
  | "blocked"
  | "manual"
  | "provider_failure";
```

Use it in both places:

```ts
stopReason: AutonomousStopReason | null;

export function stopAutonomous(reason: AutonomousStopReason): void {
```

Do not add persistent pause fields or change stale-state restoration behavior.

- [ ] **Step 7: Add focused durable-failure recording in Work**

Near `recordWorkerFailure`, add a local helper whose interface owns the complete task transition:

```ts
function recordDurableProviderFailure(
  cwd: string,
  taskId: string,
  message: string,
): void {
  store.appendTaskProgress(
    cwd,
    taskId,
    "system",
    `${message}; provider requires user action, reset to todo`,
  );
  store.updateTask(cwd, taskId, {
    status: "todo",
    assigned_to: undefined,
    blocked_reason: undefined,
  });
}
```

Before processing results, add:

```ts
const providerFailures: Array<{ taskId: string; error: string }> = [];
```

In the existing failed-result branch, after task lookup and attempt accounting but before `recordWorkerFailure`, branch on the semantic field:

```ts
const workerName = task.assigned_to ?? "crew-worker";
if (r.terminalProviderError) {
  recordDurableProviderFailure(cwd, taskId, r.terminalProviderError);
  logFeedEvent(
    cwd,
    workerName,
    "task.reset",
    taskId,
    "Provider requires user action",
  );
  providerFailures.push({ taskId, error: r.terminalProviderError });
  failed.push(taskId);
  continue;
}
```

The existing ordinary failure implementation remains unchanged below this branch.

- [ ] **Step 8: Stop autonomous continuation after recording the wave**

In the autonomous decision chain, preserve manual cancellation as the first condition and insert durable provider failure before normal completion/blocked/continue decisions:

```ts
if (signal?.aborted) {
  stopAutonomous("manual");
  appendEntry("crew-state", autonomousState);
} else if (providerFailures.length > 0) {
  stopAutonomous("provider_failure");
  appendEntry("crew-state", autonomousState);
  appendEntry("crew_wave_provider_failure", {
    prd: plan.prd,
    status: "provider_failure",
    failures: providerFailures,
  });
} else {
  // Existing allDone, blocked, and continue decisions remain unchanged.
}
```

Do not throw. All current wave results and automatic reviews must finish before this decision.

- [ ] **Step 9: Add returned text and structured details**

Build bounded user-facing text from the already bounded classifier messages:

```ts
const providerFailureText = providerFailures.length > 0
  ? `\n🛑 Durable provider failure: ${providerFailures
      .map(failure => `${failure.taskId}: ${failure.error}`)
      .join("; ")}\nAutonomous work stopped. Fix the provider account, billing, credentials, or authorization, then run Work explicitly to retry.`
  : "";
```

Ensure continuation text is suppressed:

```ts
const continueText = autonomous
  && !signal?.aborted
  && providerFailures.length === 0
  && actionableNextReady.length > 0
    ? "Autonomous mode: Continuing to next wave..."
    : signal?.aborted && autonomous
      ? "Autonomous mode stopped (cancelled)."
      : "";
```

Include `${providerFailureText}` in the Work text and add `providerFailures` to response details:

```ts
return result(text, {
  mode: "work",
  prd: plan.prd,
  wave: currentWave,
  attempted: remainingTasks.map(t => t.id),
  succeeded,
  failed,
  blocked,
  providerFailures,
  needsApproval: approvalTaskSummaries(finalNeedsApproval),
  rejected: approvalTaskSummaries(finalRejected),
  nextReady: actionableNextReady.map(t => t.id),
  autonomous: !!autonomous,
});
```

- [ ] **Step 10: Run focused lifecycle tests and TypeScript**

Run:

```bash
npm test -- --run \
  tests/crew/durable-provider-work.test.ts \
  tests/crew/graceful-shutdown.test.ts \
  tests/crew/auto-review.test.ts \
  tests/crew/state.test.ts \
  tests/crew/agent-end-autonomous.test.ts
npm exec tsc -- --noEmit
```

Expected: all tests and TypeScript pass.

- [ ] **Step 11: Commit the Work lifecycle change**

```bash
git add \
  crew/state-autonomous.ts \
  crew/handlers/work.ts \
  tests/crew/durable-provider-work.test.ts
git commit -m "fix: stop autonomous work on durable provider failure"
```

## Task 3: Final Verification and Backlog Refresh

**Files:**

- Modify: `suggestion-box.md`
- Verify: all files changed in Tasks 1 and 2

**Interfaces:**

- Consumes: the completed implementation and fresh verification evidence.
- Produces: an updated local backlog marking priorities 1 and 2 complete and naming priority 3 as next.

- [ ] **Step 1: Run all focused regression tests together**

```bash
npm test -- --run \
  tests/crew/agent-events.test.ts \
  tests/crew/lobby.test.ts \
  tests/crew/durable-provider-work.test.ts \
  tests/crew/graceful-shutdown.test.ts \
  tests/crew/auto-review.test.ts \
  tests/crew/state.test.ts \
  tests/crew/agent-end-autonomous.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full verification**

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

Expected: the full test suite passes, TypeScript reports no errors, and `git diff --check` produces no output.

- [ ] **Step 3: Run diagnostics on changed source files**

Run Pi LSP diagnostics on:

```text
crew/types.ts
crew/agents.ts
crew/lobby.ts
crew/state-autonomous.ts
crew/handlers/work.ts
tests/crew/agent-events.test.ts
tests/crew/lobby.test.ts
tests/crew/durable-provider-work.test.ts
```

Then run `lens_diagnostics` with `mode=all` and resolve every blocking finding introduced by the change.

- [ ] **Step 4: Refresh the local suggestion box**

Update `suggestion-box.md` without changing its ignored/local status:

- Mark “Fix the lobby dispatchability race” complete.
- Mark “Pause autonomous work on durable provider failure” complete, citing the design, plan, implementation commits, and fresh verification counts.
- Make “Finish current merged-worktree cleanup” the next active item.
- Update the refresh date and current `main` commit.

Do not commit `suggestion-box.md` because it is intentionally ignored.

- [ ] **Step 5: Commit any verification-driven corrections**

If verification required corrections in the files owned by this plan, stage that bounded set and commit it:

```bash
git add \
  crew/types.ts \
  crew/agents.ts \
  crew/lobby.ts \
  crew/state-autonomous.ts \
  crew/handlers/work.ts \
  tests/crew/agent-events.test.ts \
  tests/crew/lobby.test.ts \
  tests/crew/durable-provider-work.test.ts
git commit -m "test: close durable provider failure regressions"
```

If no tracked corrections were required, do not create an empty commit.

- [ ] **Step 6: Request independent review**

Request review against:

- `docs/superpowers/specs/2026-08-07-durable-provider-failure-stop-design.md`
- this implementation plan;
- the complete implementation diff from the design commit through the final implementation commit.

The reviewer must verify:

- durable classification is not duplicated;
- the task always remains `todo` on this path;
- manual cancellation priority is preserved;
- other current-wave results and automatic reviews complete;
- ordinary failures and temporary throttling retain existing behavior;
- the response, feed, progress, and autonomous state make the stop visible;
- explicit retry remains possible.

# Durable Provider Failure Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an autonomous Crew Work run after a durable provider failure while leaving the affected task in `todo` for a later explicit retry.

**Architecture:** Carry the existing durable classification through `AgentResult`, then let the Work lifecycle apply one focused transition and stop autonomous continuation. Reuse existing progress, feed, Work response, and Crew state interfaces; do not introduce a public response field or a new wave event.

**Tech Stack:** TypeScript, Node.js child processes, Vitest, Pi Messenger Crew task store and activity feed.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-07-durable-provider-failure-stop-design.md`.
- Keep the affected task in `todo` and clear `assigned_to`.
- Do not apply maximum-attempt blocking to a durable provider failure.
- Process every result already running in the current wave.
- Preserve automatic review of successful tasks in that wave.
- Preserve the rule that durable `task.done` wins over a later nonzero process exit.
- Preserve manual cancellation as the highest-priority autonomous stop reason.
- Temporary throttling and ordinary worker failures retain existing retry behavior.
- `getTerminalProviderError` remains the only durable-error classifier.
- Do not add a scheduler, pause framework, persistent pause state, background service, dependency, production module, public response field, or wave-specific event.

---

## File Structure

- Modify `crew/types.ts`: carry the durable provider result through `AgentResult`.
- Modify `crew/agents.ts`: populate it for fresh workers.
- Modify `crew/lobby.ts`: populate it for lobby workers.
- Modify `crew/state-autonomous.ts`: add the explicit stop reason.
- Modify `crew/handlers/work.ts`: keep the task retryable and stop continuation.
- Modify `tests/crew/agent-events.test.ts`: verify fresh-worker propagation.
- Modify `tests/crew/lobby.test.ts`: verify lobby-worker propagation.
- Create `tests/crew/durable-provider-work.test.ts`: verify Work lifecycle behavior.

## Task 1: Preserve the Durable Failure Result

**Files:**

- Modify: `crew/types.ts:172-188`
- Modify: `crew/agents.ts:370-426`
- Modify: `crew/lobby.ts:235-279`
- Test: `tests/crew/agent-events.test.ts:93-189`
- Test: `tests/crew/lobby.test.ts:411-454`

**Interfaces:**

- Consumes: `getTerminalProviderError(event: PiEvent): string | null`
- Produces: `AgentResult.terminalProviderError?: string`
- Invariant: the field is present only when the existing classifier returned a durable failure.

- [ ] **Step 1: Add failing result assertions**

Extend the existing fresh-worker durable quota and credential tests:

```ts
expect(result.terminalProviderError).toBe(result.error);
```

Extend the existing fresh-worker temporary-rate-limit test:

```ts
expect(result.terminalProviderError).toBeUndefined();
```

Extend the existing lobby durable-error matcher:

```ts
await expect(resultPromise).resolves.toMatchObject({
  taskId: "task-provider-error",
  exitCode: 1,
  error: "Provider error 400: 400: quota exhausted. Add more credits to continue.",
  terminalProviderError: "Provider error 400: 400: quota exhausted. Add more credits to continue.",
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
npm test -- --run tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
```

Expected: the new assertions fail because results do not expose `terminalProviderError`.

- [ ] **Step 3: Extend `AgentResult`**

Add one optional semantic field after `error` in `crew/types.ts`:

```ts
error?: string;
terminalProviderError?: string;
```

- [ ] **Step 4: Populate fresh and lobby results**

In `crew/agents.ts`, preserve the local classifier value in the resolved result:

```ts
error: progress.error,
terminalProviderError: terminalProviderError ?? undefined,
```

In `crew/lobby.ts`, do the same in `worker.resolveCompletion`:

```ts
error: terminalProviderError ?? undefined,
terminalProviderError: terminalProviderError ?? undefined,
```

Do not call the classifier again and do not alter temporary-error handling.

- [ ] **Step 5: Verify Task 1**

```bash
npm test -- --run tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

Expected: both commands pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add crew/types.ts crew/agents.ts crew/lobby.ts \
  tests/crew/agent-events.test.ts tests/crew/lobby.test.ts
git commit -m "fix: preserve durable provider worker failures"
```

## Task 2: Apply the Autonomous Work Policy

**Files:**

- Modify: `crew/state-autonomous.ts:8-63`
- Modify: `crew/handlers/work.ts:73-92,341-608`
- Create: `tests/crew/durable-provider-work.test.ts`

**Interfaces:**

- Consumes: `AgentResult.terminalProviderError?: string`
- Produces: autonomous stop reason `"provider_failure"`
- Invariant: the failed task remains `todo`, ownership is cleared, and no continuation entry is emitted.

- [ ] **Step 1: Create focused failing lifecycle tests**

Create `tests/crew/durable-provider-work.test.ts` using the local worker-agent, directory, autonomous-state reset, mocked `spawnAgents`, and mock-context patterns from `tests/crew/graceful-shutdown.test.ts` and `tests/crew/auto-review.test.ts`.

Use this result builder so Work consumes a semantic fact rather than reclassifying strings:

```ts
function failedResult(taskId: string, terminalProviderError?: string): AgentResult {
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
```

Add a table-driven durable test with these exact inputs:

```ts
const durableErrors = [
  "Provider error 429: quota has been exhausted for this account",
  "Provider error 401: Invalid API key",
];
```

For each row, write project config with `maxAttemptsPerTask: 1`, `review.enabled: false`, and artifacts disabled. Create a plan and one task, make mocked `spawnAgents` return `failedResult(task.id, error)`, call `startAutonomous(cwd, 1)`, and execute Work with `{ action: "work", autonomous: true, concurrency: 1 }`. Use `vi.fn()` as `appendEntry` and assert:

```ts
expect(store.getTask(cwd, task.id)).toMatchObject({
  status: "todo",
  attempt_count: 1,
});
expect(store.getTask(cwd, task.id)?.assigned_to).toBeUndefined();
expect(autonomousState.active).toBe(false);
expect(autonomousState.stopReason).toBe("provider_failure");
expect(response.content[0].text).toContain(error);
expect(response.content[0].text).toContain("Autonomous work stopped");
expect(response.content[0].text).not.toContain("Continuing to next wave");
expect(appendEntry).not.toHaveBeenCalledWith("crew_wave_continue", expect.anything());
```

In the same test, read the task progress and feed and assert:

```ts
expect(progressText).toContain(error);
expect(readFeedEvents(cwd, 20)).toContainEqual(expect.objectContaining({
  type: "task.reset",
  target: task.id,
  preview: "Provider requires user action",
}));
```

The `maxAttemptsPerTask: 1` setup proves this path bypasses normal attempt-limit blocking.

Add three focused regressions:

1. Return `failedResult(task.id)` with `maxAttemptsPerTask: 1`; assert the existing ordinary path blocks the task with `Max attempts (1) reached`.
2. Execute an autonomous durable failure, then execute an explicit non-autonomous Work call; assert `spawnAgents` is called twice and `attempt_count` becomes `2`.
3. Complete one task inside the mocked worker execution while returning a durable failure for a sibling; mock `reviewImplementation` to return `SHIP`, then assert the completed task is reviewed and remains `done`, the failed task is `todo`, and the stop reason is `provider_failure`.

Do not add a duplicate temporary-429 Work test. Task 1 already proves temporary errors do not produce `terminalProviderError`; Task 2 proves absence of that field retains ordinary Work behavior.

- [ ] **Step 2: Run the lifecycle test and confirm RED**

```bash
npm test -- --run tests/crew/durable-provider-work.test.ts
```

Expected failures:

- the durable task follows ordinary maximum-attempt blocking;
- `provider_failure` is not an accepted stop reason;
- autonomous continuation is not suppressed;
- the Work response does not explain the stop.

- [ ] **Step 3: Add the stop-reason type**

In `crew/state-autonomous.ts`, define and reuse:

```ts
export type AutonomousStopReason =
  | "completed"
  | "blocked"
  | "manual"
  | "provider_failure";
```

Use `AutonomousStopReason | null` for state and `AutonomousStopReason` for `stopAutonomous`. Do not add another state field.

- [ ] **Step 4: Add the focused task transition**

Near `recordWorkerFailure`, add:

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

In `execute`, collect only internal display/decision data:

```ts
const durableProviderFailures: Array<{ taskId: string; error: string }> = [];
```

After the existing `done`, `blocked`, graceful-shutdown, task lookup, and attempt-accounting checks—but before `recordWorkerFailure`—handle the semantic result:

```ts
if (r.terminalProviderError) {
  recordDurableProviderFailure(cwd, taskId, r.terminalProviderError);
  logFeedEvent(
    cwd,
    workerName,
    "task.reset",
    taskId,
    "Provider requires user action",
  );
  durableProviderFailures.push({ taskId, error: r.terminalProviderError });
  failed.push(taskId);
  continue;
}
```

Keeping this branch after the existing `done` check preserves durable `task.done` precedence.

- [ ] **Step 5: Stop continuation using existing state persistence**

Keep manual cancellation first. Insert the durable branch before completion, blocked, and continuation decisions:

Insert this branch immediately after the existing manual-cancellation branch and before the existing completion check:

```ts
else if (durableProviderFailures.length > 0) {
  stopAutonomous("provider_failure");
  appendEntry("crew-state", autonomousState);
}
```

Leave the existing completion, blocked, and continuation branches after it without changing their implementation. Do not emit a new wave-specific entry.

- [ ] **Step 6: Explain the stop in the existing Work response**

Build bounded text from the classifier's already bounded messages:

```ts
const providerFailureText = durableProviderFailures.length > 0
  ? `\n🛑 Durable provider failure: ${durableProviderFailures
      .map(failure => `${failure.taskId}: ${failure.error}`)
      .join("; ")}\nAutonomous work stopped. Fix the provider account, billing, credentials, or authorization, then run Work explicitly to retry.`
  : "";
```

Include `providerFailureText` in the existing response text. Suppress continuation text when `durableProviderFailures.length > 0`:

```ts
const continueText = autonomous
  && !signal?.aborted
  && durableProviderFailures.length === 0
  && actionableNextReady.length > 0
    ? "Autonomous mode: Continuing to next wave..."
    : signal?.aborted && autonomous
      ? "Autonomous mode stopped (cancelled)."
      : "";
```

Do not add a field to response details.

- [ ] **Step 7: Verify Task 2**

```bash
npm test -- --run \
  tests/crew/durable-provider-work.test.ts \
  tests/crew/graceful-shutdown.test.ts \
  tests/crew/auto-review.test.ts \
  tests/crew/state.test.ts \
  tests/crew/agent-end-autonomous.test.ts
npm exec tsc -- --noEmit
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add crew/state-autonomous.ts crew/handlers/work.ts \
  tests/crew/durable-provider-work.test.ts
git commit -m "fix: stop autonomous work on durable provider failure"
```

## Controller Verification After Both Tasks

The controller performs these checks after task-scoped reviews. This is not a third implementation task.

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

Run LSP diagnostics on all changed TypeScript files, then run `lens_diagnostics` with `mode=all`. Obtain one independent whole-change review against the approved design and this plan.

After verification and review pass, refresh the ignored local `suggestion-box.md` to mark priorities 1 and 2 complete and make merged-worktree cleanup the next active item. Do not include that local housekeeping file in an implementation commit.

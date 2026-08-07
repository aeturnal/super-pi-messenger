# Durable Provider Failure Stop Design

**Date:** 2026-08-07  
**Status:** Approved design

## Goal

Stop the current autonomous Work run when a Crew worker reports a durable provider failure, while leaving the affected task ready for an explicit retry after the provider problem is fixed.

A durable provider failure is one the existing provider-error classifier identifies as requiring account, billing, credential, or authorization changes. Temporary throttling and ordinary worker failures remain retryable.

## Scope

This is a narrow correction to the existing Work lifecycle. It does not add a scheduler, general pause framework, persistent pause state, background service, or new module.

The implementation must preserve:

- processing of every worker result already running in the current wave;
- automatic review of successful tasks from that wave;
- ordinary retry and maximum-attempt behavior for other worker failures;
- retry behavior for temporary throttling;
- explicit retry through a later user-initiated Work command;
- identical durable-failure behavior for fresh and lobby workers;
- the existing rule that a durable `task.done` state wins over a later nonzero process exit.

## Existing Behavior

`crew/utils/progress.ts:getTerminalProviderError` already classifies terminal provider events. Fresh workers in `crew/agents.ts` and lobby workers in `crew/lobby.ts` terminate the affected process and return a failed `AgentResult`.

The semantic fact that the failure is durable is then lost. `crew/handlers/work.ts` sends the result through `recordWorkerFailure`, which resets the task to `todo` until the maximum attempt count is reached. Autonomous continuation can therefore start another wave under the same broken provider account.

## Design

### Result interface

Extend `AgentResult` with one optional field:

```ts
terminalProviderError?: string;
```

The fresh-worker and lobby-worker implementations set this field only when the existing `getTerminalProviderError` classifier returns a durable provider error. The existing `error` field remains populated for display and compatibility.

This interface carries the already-known semantic result across the existing process seam. Work must not repeat the classifier or infer durability from an error string.

### Work lifecycle

Work processes all results from the current wave before deciding whether to continue.

For each result with `terminalProviderError` whose task is not already `done` or `blocked`:

1. Preserve normal launch-attempt accounting.
2. Append a task-progress entry containing the bounded provider-error message.
3. Set the task to `todo` and clear `assigned_to`.
4. Emit a visible feed event explaining that autonomous work stopped because the provider requires user action.
5. Record the durable provider failure for the wave-level continuation decision.

The maximum-attempt blocking rule does not apply to this result. The task itself is not defective and must remain `todo`, even if this launch reaches the configured attempt limit.

Other results from the same wave continue through their existing paths. Successful tasks still receive automatic review. Ordinary failures still use `recordWorkerFailure` and can become blocked at their attempt limit.

### Autonomous stop state

Extend the autonomous stop-reason interface with:

```ts
"provider_failure"
```

After the current wave is recorded, a durable provider failure takes precedence over normal ready-task continuation. Work calls `stopAutonomous("provider_failure")`, persists the state entry, and emits a bounded wave-level entry containing the affected task IDs and provider-error messages.

Manual cancellation remains higher priority if the abort signal is already set. Completed work cannot coincide with a durable failure because the affected task remains `todo`.

### Returned message

The Work result must clearly state:

- which task or tasks encountered a durable provider failure;
- that autonomous work stopped;
- that the provider account, billing, credentials, or authorization must be fixed;
- that a later explicit Work command can retry.

The normal “Continuing to next wave” text must not appear.

### Explicit retry

No persistent pause flag is stored. After the provider problem is fixed, a later explicit `work` or autonomous `work` action sees the task in `todo` and may launch it again normally.

## Error Classification

The existing classifier remains the only implementation that decides whether a provider failure is durable. This change does not broaden or narrow its patterns.

Examples already treated as durable include exhausted quota, disabled billing, payment required, invalid credentials, disabled accounts, authentication failure, and durable authorization failure.

A temporary rate-limit response that the classifier does not identify as exhausted quota remains an ordinary retryable failure.

## Testing

Focused RED/GREEN tests must prove:

1. A durable quota failure stops later autonomous waves.
2. A durable credential failure stops later autonomous waves.
3. The affected task remains `todo` with its assignment cleared.
4. Reaching the normal attempt limit does not block a task whose current result is a durable provider failure.
5. Temporary throttling retains ordinary retry behavior and does not use the provider-failure stop reason.
6. An ordinary worker failure retains existing retry and maximum-attempt behavior.
7. Progress, feed, returned Work text, and autonomous state expose the stop reason.
8. Successful tasks from the same wave still complete and receive automatic review.
9. A later explicit Work action can attempt the task again.
10. Fresh and lobby worker results carry the same optional durable-failure field.

Verification must include focused Work lifecycle tests, focused fresh/lobby provider-error tests, the full test suite, TypeScript checking, diff checks, and diagnostics proportional to the changed files.

## Files Expected to Change

- `crew/types.ts` — extend the `AgentResult` interface.
- `crew/agents.ts` — preserve the durable provider-error fact in fresh-worker results.
- `crew/lobby.ts` — preserve the same fact in lobby-worker results.
- `crew/state-autonomous.ts` — add the explicit autonomous stop reason.
- `crew/handlers/work.ts` — keep the task retryable, report the reason, and stop continuation.
- Existing focused tests under `tests/crew/` — add RED/GREEN coverage without creating a parallel test harness.

## Rejected Approaches

### Reclassify `AgentResult.error` in Work

Rejected because it duplicates provider classification outside its current implementation. That would reduce locality and allow the two classifiers to drift.

### Throw a special process error

Rejected because it would short-circuit aggregate worker handling, complicate `Promise.all`, and risk losing results from other workers in the current wave.

### Add persistent pause state

Rejected because explicit retry is sufficient. A durable provider failure should stop one autonomous run, not disable future Work actions.

## Deletion Test

If the new `terminalProviderError` field and its Work handling were deleted, durability knowledge would again disappear at the process seam and retry policy would spread back into error-string inference or repeated worker launches. The small interface therefore provides leverage and keeps classification local to its existing implementation.

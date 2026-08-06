# Lobby Dispatchability Race Design

**Date:** 2026-08-06

## Goal

Prevent Crew from assigning a task to a lobby worker after a stop signal has been sent or observed.

## Problem

Lobby workers are long-running Pi child processes that wait for tasks. `crew/registry.ts:getAvailableLobbyWorkers` currently treats an idle lobby worker as available when `proc.exitCode === null`.

A child process does not always exit immediately after a stop signal is sent. During that gap, `exitCode` can remain `null` while either:

- `proc.killed` is `true`, meaning Node accepted a request to send a signal; or
- `proc.signalCode` is non-null, meaning the process ended because of a signal.

The current availability check can return that worker. A caller can then assign a task to a process that is already stopping. The process may exit before doing the task, wasting a concurrency slot and forcing task recovery.

The existing lobby test process hides this gap because its `kill()` implementation immediately sets `exitCode = 0`.

## Root Cause

Worker liveness has two different predicates in the same registry:

- `hasActiveWorker` checks both `exitCode` and `signalCode`.
- `getAvailableLobbyWorkers` checks only `exitCode`.

Lobby dispatch therefore uses a weaker process-state rule than active-worker detection. It also ignores `killed`, which is the earliest local evidence that a stop request was made.

## Chosen Design

Keep the existing worker registry and strengthen only the lobby availability predicate.

An idle lobby worker is available only when all of these conditions hold:

- it belongs to the requested normalized cwd;
- it is a lobby worker;
- it has no assigned task;
- `proc.exitCode === null`;
- `proc.signalCode === null`;
- `proc.killed === false`.

No new lifecycle state, timer, lease, heartbeat, or process manager will be added.

## Alternatives Rejected

### Remove registry entries immediately when stopping a worker

This would hide the worker before the operating system confirms its exit, but it would spread registry cleanup across every kill path. The close handler already owns final cleanup. Changing that ownership would increase race and cleanup risk.

### Add an explicit `stopping` field

This would duplicate state already exposed by the child process. Every termination path would have to set it correctly. The current defect does not justify another mutable state value.

### Add leases or heartbeats

Leases and heartbeats solve missing or stale process ownership over longer periods. This defect is a short local gap after a known signal request. They would add complexity without addressing the root cause more directly.

## Test Design

Add focused registry tests because the availability decision lives in `crew/registry.ts`.

The tests will register lobby worker fixtures and prove:

1. A healthy idle process with `exitCode: null`, `signalCode: null`, and `killed: false` is available.
2. A process with `killed: true` is unavailable even when `exitCode` and `signalCode` are still null.
3. A process with a terminal `signalCode` is unavailable even when `exitCode` is null.
4. An assigned healthy lobby worker remains unavailable.
5. A process with a non-null `exitCode` remains unavailable.

The first implementation step must be a RED test that fails against the current predicate. The production change should then be limited to the availability predicate.

## Preserved Behavior

- Healthy exact-match lobby workers remain reusable.
- Assigned lobby workers remain unavailable.
- Lobby compatibility rules remain unchanged.
- Worker registration and close cleanup remain unchanged.
- Active-worker detection remains unchanged.
- Fresh worker fallback remains unchanged.
- The shared concurrency ceiling remains unchanged.

## Verification

Run, in order:

1. The focused registry test file.
2. The focused lobby and Team work test files.
3. TypeScript compilation without output.
4. The full Vitest suite.
5. LSP and pi-lens diagnostics for changed files.

## Scope

Expected production change: `crew/registry.ts` only.

Expected test change: `tests/crew/registry.test.ts` only.

No unrelated refactor is included.

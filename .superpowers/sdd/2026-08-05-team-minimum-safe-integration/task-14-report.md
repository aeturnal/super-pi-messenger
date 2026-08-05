# Task 14 Report

## Status
Implemented Work-owned waiting for assigned lobby workers. `work.execute` now retains successfully assigned lobby workers, waits for their completion alongside newly spawned workers, and combines both result lists before the existing result-processing path.

## RED evidence
Before the production change, ran:

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts
```

Result: the new lobby-worker wait test failed as expected. `work.execute` settled before the mocked lobby process emitted `close`.

## Verification
Ran:

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts tests/crew/team-work.test.ts
npm exec tsc -- --noEmit
git diff --check
```

## Files
- `crew/handlers/work.ts`
- `tests/crew/graceful-shutdown.test.ts`
- `tests/crew/team-work.test.ts`
- `.superpowers/sdd/2026-08-05-team-minimum-safe-integration/task-14-report.md`

## Commit
`fix: await lobby workers in Crew work`

## Self-review
- Work records a lobby worker only after its assignment succeeds.
- Fresh and lobby completion promises start together and are awaited together.
- Result handling remains a single existing path using the combined result array.
- The Team Work lobby mock now provides the consumed completion interface so its existing tests retain their intended behavior.

## Concerns
- The full test suite was not run; verification is limited to the directly affected Work, lobby, and Team Work tests plus typechecking.

## Fix Round 1

### Status
Fixed both review findings without changing the shared concurrency budget or dispatcher ownership. An already-aborted Work request now has zero assignment slots. After lobby assignment, Work listens for cancellation, terminates only its assigned work-managed lobby processes through the registry's existing SIGTERM/SIGKILL escalation path, waits for their close results, and classifies those results as graceful interruptions.

The unified Work result processor now recognizes non-zero, non-autonomous lobby results. It performs the recovery formerly owned by the lobby close handler: reset and clear assignment below the attempt limit, or block and clear assignment at the limit. The Task 13 close-handler suppression remains in place, so each result causes one task mutation.

### RED evidence
Before the production correction, ran:

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts
```

Result: 4 regressions failed for the expected missing behavior:
- an already-aborted signal still assigned a lobby task;
- abort after assignment did not settle Work or terminate the assigned lobby process;
- `close(1)` left a below-limit lobby task `in_progress`;
- `close(1)` left an at-limit lobby task `in_progress`.

### Verification evidence
Ran after the correction:

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts tests/crew/team-work.test.ts
npm exec tsc -- --noEmit
git diff --check
```

Results:
- Graceful shutdown: 16 tests passed.
- Focused Work/lobby suite: 3 files and 72 tests passed.
- TypeScript typecheck: exited 0.
- Diff check: exited 0.

### Regression coverage
- Already-aborted Work does not assign or increment a lobby task attempt.
- Abort after assignment terminates only the assigned work-managed lobby worker, leaves an idle lobby worker alive, settles Work, and records exactly one graceful task recovery.
- Non-zero lobby exit below the limit performs exactly one reset mutation.
- Non-zero lobby exit at the limit performs exactly one block mutation.

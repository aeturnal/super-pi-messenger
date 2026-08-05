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

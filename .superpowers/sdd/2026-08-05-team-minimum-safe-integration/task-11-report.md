# Task 11 Report

## Status
Implemented one effective Crew concurrency budget in `work.execute`. Active registered workers for the current project consume slots first; compatible lobby assignments consume the remaining slots; only the leftover task slots are passed to fresh-worker spawning. No dispatcher, overlay, or lobby compatibility behavior changed.

## RED evidence
Ran before production changes:

```bash
npm exec vitest -- run tests/crew/team-work.test.ts tests/crew/spawn.test.ts
```

Result: `team-work.test.ts` failed the new mixed-worker cases as expected. With concurrency 1 and 2, the handler assigned two lobby workers and passed all three ready tasks to fresh spawning, producing three total assignments instead of the requested limit. `spawn.test.ts` passed.

## Verification
Ran:

```bash
npm exec vitest -- run tests/crew/team-work.test.ts tests/crew/spawn.test.ts tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
```

Results:
- Vitest: 3 files and 28 tests passed.
- TypeScript typecheck: exited 0.
- `git diff --check`: exited 0.

## Files
- `crew/handlers/work.ts`
- `tests/crew/team-work.test.ts`
- `tests/crew/spawn.test.ts`
- `tests/crew/graceful-shutdown.test.ts`
- `.superpowers/sdd/2026-08-05-team-minimum-safe-integration/task-11-report.md`

## Commit
`fix: share Crew worker concurrency budget`

## Self-review
- `takeWorkSlots` limits fresh tasks only after actual active workers and successful compatible lobby assignments have consumed the shared budget.
- The lobby loop stops at its available slot count without changing Task 10's strict compatibility selection.
- Active-worker counting is scoped to the current cwd through the existing registry lookup.
- The fractional-concurrency regression now expects the single clamped slot, rather than the former unbounded fresh task list.
- No queue, scheduler, overlay path, or dispatcher was added or changed.

## Concerns
- The full test suite was not run; verification was limited to the brief-required focused tests and TypeScript typecheck.

## Fix Round 1

### Status
Registered active workers now consume concurrency slots even while their task is still `todo`. Their task IDs are excluded from both lobby assignment and fresh-worker candidates, preventing a second dispatch before `task.start` updates its status.

### Regression test
Added a `team-work` regression that registers an active worker against a `todo` task, then verifies neither a compatible lobby worker nor a fresh worker receives that task.

### RED evidence
Before the production change, ran:

```bash
npm exec vitest -- run tests/crew/team-work.test.ts
```

The new regression failed because the compatible lobby worker was assigned the registered worker's `todo` task.

### Verification
Ran:

```bash
npm exec vitest -- run tests/crew/team-work.test.ts tests/crew/spawn.test.ts tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
git diff --check
```

Results:
- Vitest: 3 files and 29 tests passed.
- TypeScript typecheck: exited 0.
- Diff check: exited 0.

### Commit
`fix: prevent redispatch of registered Crew workers`

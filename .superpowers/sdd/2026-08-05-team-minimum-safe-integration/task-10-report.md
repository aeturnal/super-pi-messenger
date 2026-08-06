# Task 10 Report

## Status
Implemented exact lobby-worker compatibility checks. `work.execute` now assigns a ready task to a lobby worker only when its normalized cwd, resolved model, worker role, and Superpowers guidance mode match. Incompatible workers remain idle and the task proceeds through the existing fresh-worker path. Overlay rendering remains passive; Crew work lifecycle is the only dispatcher changed.

## RED evidence
Ran:

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
```

Before production changes, the new tests failed as expected because lobby entries lacked compatibility metadata and `work.execute` did not call the compatibility check. After resetting test mock state, the RED run had exactly those two new failures; the pre-existing tests passed.

## GREEN evidence
Ran:

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
npm exec tsc -- --noEmit
```

Results:
- Focused Vitest run: 3 files and 49 tests passed.
- TypeScript typecheck: exited 0.

## Files
- `crew/registry.ts`
- `crew/lobby.ts`
- `crew/handlers/work.ts`
- `tests/crew/lobby.test.ts`
- `tests/crew/team-work.test.ts`

## Commit
`fix: match lobby workers to task requirements`

## Self-review
- Lobby entries record the launched model, fixed Crew worker role, Superpowers guidance state, and normalized cwd.
- Compatibility uses strict equality and does not reconfigure workers or match model names loosely.
- Task metadata is updated only after a compatible worker is selected; the new work-handler test proves an incompatible candidate leaves both worker assignment and task state unchanged.
- Registry lookups normalize cwd consistently, so normalized lobby entries remain discoverable during their existing lifecycle.
- No overlay, scheduler, or unrelated execution path was changed.

## Concerns
- The full test suite was not run; only the brief-required focused tests and TypeScript typecheck were run.

## Fix Round 1

### Root cause
`work.execute` resolved the Team role for model selection but hard-coded `LobbyCompatibility.role` to `"worker"`. A generic warm lobby worker could therefore match a task resolved to the `scout` Team role.

### RED evidence
Ran:

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
```

Before the production change, the new end-to-end Scout mismatch test failed because the compatibility requirement contained `role: "worker"` instead of the resolved `role: "scout"`. The other 49 tests passed.

### GREEN evidence
Changed the compatibility requirement to use the resolved Team role and fall back to `"worker"` only when no role resolves. Ran:

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
npm exec tsc -- --noEmit
```

Results:
- Focused Vitest run: 3 files and 50 tests passed.
- TypeScript typecheck: exited 0.

The new Scout test proves a generic `worker` lobby entry is left idle, with no assignment, and the Scout task is sent to the fresh-worker path.

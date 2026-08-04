# Task 7 Report — Compact Crew Event Artifacts

## Source

- Upstream commit: `a97fbf2cc41e4d5c90fb11acfe4fe77dad7efbe2` (`a97fbf2`, `fix: compact Crew event artifacts`)
- Imported commit: `ecd4251e6dead53a1ee67df65e283f8f21084f85`
- Import method: `git cherry-pick -x a97fbf2`; upstream author and trailer retained.

## Composition

- Git auto-merged `CHANGELOG.md`, `README.md`, and `crew/agents.ts`; it did not stop for a conflict.
- The import replaces the parsed-event array with the latest final assistant text, compacting only JSONL artifact `message_update` events.
- `updateProgress` remains on every parsed event. Final output, terminal provider errors, token/progress accounting, output artifacts, and metadata remain available.
- Positive configured `cleanupDays` removes expired artifact files.
- Reviewed Team context, model precedence, Superpowers guidance/guard/provenance, and controller-only approval boundaries remain outside the event-processing change. No fork adaptation was needed, so no new RED/GREEN cycle applied.

## Verification

- `npm exec vitest -- run tests/crew/agent-events.test.ts tests/crew/utils/artifacts.test.ts tests/crew/live-progress.test.ts tests/crew/graceful-shutdown.test.ts tests/crew/superpowers-launch.test.ts` — exit `0`; 5 files / 26 tests passed.
- `npm exec tsc -- --noEmit` — exit `0`; no output.
- `git diff --check` — exit `0`; no output.

## Self-Review

No Critical or Important issue found. The imported tests demonstrate repeated snapshot removal, final output retention, terminal provider failure handling, and cleanup. Direct diff review confirms terminal errors override the process exit result and continue to flow to progress and artifact metadata.

## Tracked Evidence

The ledger and checkpoint evidence are recorded in `docs/superpowers/plans/2026-08-04-upstream-v0.15.0-integration.md` and `docs/superpowers/reports/2026-08-04-upstream-v0.15.0-integration-report.md`.

## Fix Round 1 — Terminal Assistant Provider Errors

### Root Cause

The provider fail-fast test covered only a synthetic `provider_error` object with a nested numeric status. Pi JSON mode emits normal assistant `message_update`/`message_end` events. Real provider failures set `message.role` to `assistant`, `message.stopReason` to `error`, and put the error in `message.errorMessage`; Pi may format its HTTP status as a leading string such as `400: ...`. The detector required a nested numeric status, so this real event shape returned `null` and `runAgent` did not fail fast.

### TDD Evidence

- **RED:** Added realistic terminal assistant `message_update` and `message_end` quota-error regressions. `npm exec vitest -- run tests/crew/agent-events.test.ts` failed as expected: both assertions reported no `SIGTERM` call.
- **GREEN:** `65d9642` (`fix: detect terminal Crew provider errors`) recognizes only terminal assistant error events (plus the established synthetic provider-error compatibility event), derives the allowlisted 4xx status from the structured message or a leading formatted `errorMessage`, and retains the existing quota/auth semantics. It does not inspect tool results, arbitrary tool output, or ordinary assistant text.

### Verification

- `npm exec vitest -- run tests/crew/agent-events.test.ts tests/crew/utils/artifacts.test.ts tests/crew/live-progress.test.ts tests/crew/graceful-shutdown.test.ts tests/crew/superpowers-launch.test.ts` — exit `0`; 5 files / 28 tests passed.
- `npm exec tsc -- --noEmit` — exit `0`; no output.
- `git diff --check` — exit `0`; no output.

The compaction, final-output, progress/token, artifact/metadata, retention, Team/model, and Superpowers boundaries remain untouched. Explicit additional token/metadata preservation coverage remains deferred to final review.

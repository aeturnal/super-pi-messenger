# Eval: independent parallel utilities

## Purpose

Measure whether Crew decomposes, dispatches, implements, and reviews three genuinely independent tasks in one wave, without artificial file overlap or nested orchestration.

## Fixed fixture and task ownership

The dependency-free Node ESM fixture has exactly three task-owned source files:

1. Implement `parseDuration(input)` in `src/duration.mjs`.
2. Implement `formatBytes(bytes)` in `src/format-bytes.mjs`.
3. Implement `parseRetryAfter(value, nowMs)` in `src/retry-after.mjs`.

Each task owns only its listed source file. Built-in `node:test` acceptance files are immutable inputs, are not task-owned, and no dependency additions are allowed.

`parseDuration(input)` accepts one nonnegative decimal plus `ms`, `s`, `m`, or `h` (with permitted surrounding/intervening whitespace), returns milliseconds, and throws `TypeError` for empty, negative, compound, unsupported, or non-string input. `formatBytes(bytes)` accepts a finite nonnegative integer, uses `B`, `KiB`, `MiB`, `GiB`, and `TiB`, formats larger units to at most one decimal, and throws `TypeError` otherwise. `parseRetryAfter(value, nowMs)` accepts an HTTP `Retry-After` string and finite epoch milliseconds, returns a nonnegative delay for digit seconds or valid HTTP dates (past dates clamp to zero), returns `null` for empty/invalid headers, and throws `TypeError` for invalid `nowMs`.

## Controlled procedure

Use the checked stock profile: worker concurrency is exactly three; planning is reviewed at most once; normal stock task review applies; artifacts are disabled. The operator inspects the generated plan before work. A materially different decomposition is recorded, never silently rewritten. The tooling resets and verifies deterministically but never launches a model; the human separately runs the printed command.

## Acceptance

- The fixture has exactly these three no-dependency tasks and disjoint task-owned source files.
- All three immutable test hashes match the seed; no acceptance test is changed, removed, renamed, or added.
- The exact stub sentinels are replaced and explicit `node --test` succeeds.
- The worktree is a Git repository at the recorded seed commit and its manifest identifies fixture and profile hashes.
- Any integrity mismatch fails before model work is judged successful.

## Observations to record

Record whether all three tasks dispatch in the same wave, worker execution overlaps, a reservation conflict occurs, and every task receives review. Also record nested orchestration (agents, controllers, worktrees, or orchestration), sessions by role, retries, review cycles, human interventions, duration, and available provider usage metadata. A stock failure is still a valid baseline when accurately recorded.

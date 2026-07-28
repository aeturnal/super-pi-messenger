# Eval: independent parallel utilities

## Purpose

Measure whether Crew decomposes, dispatches, implements, and reviews three genuinely independent tasks in one wave without artificial file overlap or nested orchestration.

## Fixed task

The dependency-free Node ESM fixture has exactly three tasks:

1. Implement `parseDuration(input)` in `src/duration.mjs`.
2. Implement `formatBytes(bytes)` in `src/format-bytes.mjs`.
3. Implement `parseRetryAfter(value, nowMs)` in `src/retry-after.mjs`.

## Fixture boundary

Each task owns only its listed source path. Built-in `node:test` acceptance files are immutable inputs, are not task-owned, and no dependency additions are allowed. `parseDuration(input)` accepts one nonnegative decimal plus `ms`, `s`, `m`, or `h`, with surrounding or intervening whitespace, and returns milliseconds. `formatBytes(bytes)` accepts a finite nonnegative integer and formats `B`, `KiB`, `MiB`, `GiB`, or `TiB` to at most one decimal. `parseRetryAfter(value, nowMs)` accepts digit seconds or valid HTTP dates, clamps past dates to zero, returns `null` for empty or invalid headers, and requires finite epoch milliseconds. Invalid contract inputs throw `TypeError`.

## Procedure

- Worker concurrency: `3`.
- Planning is reviewed at most once; normal stock task review applies.
- Artifacts are disabled.
- The operator inspects the generated plan before work and records, rather than silently rewrites, a materially different decomposition.
- Tooling resets and verifies deterministically but never launches a model; the human separately runs the printed command.

## Deterministic acceptance

- The fixture has exactly these three no-dependency tasks and disjoint task-owned source files.
- All three immutable test hashes match the seed; no acceptance test is changed, removed, renamed, or added.
- The exact stub sentinels are replaced and explicit `node --test` succeeds.
- The worktree is a Git repository at the recorded seed commit and its manifest identifies fixture and profile hashes.
- Any integrity mismatch fails before model work is judged successful.

## Supervised observations

Record same-wave dispatch, worker overlap, reservation conflicts, and whether every task receives review. Also record nested orchestration (agents, controllers, worktrees, or orchestration), sessions by role, retries, review cycles, human interventions, duration, and available provider usage metadata.

## Product target versus stock baseline

A stock failure is still a valid baseline when accurately recorded. It does not establish future product behavior and must not be emulated through undocumented manual intervention.

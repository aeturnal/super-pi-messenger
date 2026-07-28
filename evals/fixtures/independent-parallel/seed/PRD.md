# Independent Parallel Utility Tasks

Implement exactly these three independent tasks. They have no external dependencies and may be completed in parallel.

## Shared constraints

- Implement only the source file owned by your task.
- Do not edit any file in `test/`; acceptance tests are immutable and are not task-owned.
- Do not add dependencies or modify `package.json`.
- Run `npm test` to verify all acceptance tests.

## Task 1 — Parse durations

Own only `src/duration.mjs`. No test files are owned by this task. Export `parseDuration(input)`, which parses a nonnegative decimal duration with exactly one `ms`, `s`, `m`, or `h` unit, allowing surrounding whitespace and whitespace before the unit. Invalid values throw `TypeError`.

Immutable acceptance: `test/duration.test.mjs`.

## Task 2 — Format byte counts

Own only `src/format-bytes.mjs`. No test files are owned by this task. Export `formatBytes(bytes)`, which formats finite nonnegative integer byte counts using binary units `B`, `KiB`, `MiB`, `GiB`, and `TiB`, rounded to one decimal place outside bytes. Invalid values throw `TypeError`.

Immutable acceptance: `test/format-bytes.test.mjs`.

## Task 3 — Parse Retry-After

Own only `src/retry-after.mjs`. No test files are owned by this task. Export `parseRetryAfter(value, nowMs)`, which parses either whole delay seconds or an HTTP-date into nonnegative milliseconds relative to finite `nowMs`; malformed or blank values return `null`. An invalid `nowMs` throws `TypeError`.

Immutable acceptance: `test/retry-after.test.mjs`.

# Eval result: stock pi-messenger 0.14.1 — independent parallel

**Status:** `FAILED`

The supervised baseline ran to a terminal Crew state. All three utility implementations were committed and passed immutable deterministic verification, but the orchestration lifecycle failed: work began without the operator issuing a work command, every worker process exited without marking its task complete, each task was retried once, and all three tasks ended blocked at the configured maximum of two attempts.

## Run identity

| Evidence | Value |
| --- | --- |
| Run ID | `019faa38-ef74-741a-aa84-0003d80940dc` |
| Date | `2026-07-28` |
| Operator | `dominic` (human-supervised) |
| Fixture version | `independent-parallel`; profile SHA-256 `98a3e0441cf7d9449c8ee83ed27fa7679709b0ac2a580a694c02ec3612d915a8` |
| Seed commit | `21a724043f3fb58b1ce5ad66008f993d78ed3ffb` |
| Final commit | `e774a215c89814899a62972e5b61c5a99d88783d` |
| Stock package | `npm:pi-messenger@0.14.1` |
| Profile | `evals/profiles/stock-baseline.json`; SHA-256 `98a3e0441cf7d9449c8ee83ed27fa7679709b0ac2a580a694c02ec3612d915a8` |

## Functional outcome

- [x] Functional outcome recorded: pass — all six immutable utility tests passed.
- [x] Test-integrity outcome recorded: pass — all three acceptance-test hashes matched the reset manifest.
- [x] Verifier result recorded: pass in ignored worktree `.git/pi-super-messenger-eval-verification.json`; exit code `0`.
- [x] Final Git state recorded: three implementation commits after the seed; only generated `.pi/` Crew state was untracked.

## Orchestration observations

| Evidence | Value |
| --- | --- |
| Task count | 3 |
| Worker count | 6 worker processes across two attempts per task; maximum observed concurrent task workers: 2 |
| Tasks dispatched in same wave | Partial — tasks 1 and 2 started together; task 3 started only after task 2 blocked |
| Worker-overlap | Observed for pairs of tasks; configured three-worker overlap was not observed |
| Reservation conflicts | None recorded in the Crew feed |
| Nested orchestration | None recorded |

The operator issued only the plan request with `autoWork: false` and never issued `work`. The plan tool result stated that automatic work was not started, but the Crew feed recorded task 1 and task 2 starting 17 milliseconds after `plan.done`. Each first-attempt worker committed a correct implementation and exited with code 0 without marking its task complete. Crew reset each task, launched a second worker, and ultimately marked all three tasks blocked with `Max attempts (2) reached` even though deterministic verification passed.

## Review outcome

| Evidence | Value |
| --- | --- |
| Reviewer count | 0 implementation reviewers observed |
| Task and integration review | No task review or integration review recorded before the terminal blocked state |
| Important findings | Work began despite `autoWork: false`; successful worker commits were not reflected as completed task state; configured concurrency 3 produced at most 2 overlapping task workers |
| Escaped defects | No utility defect escaped immutable verification; orchestration state incorrectly reported all functionally successful tasks as blocked |

## Reliability

| Evidence | Value |
| --- | --- |
| Retry count | 3 total retries — one per task |
| Review-cycle count | 0 |
| Human interventions | None after the initial plan instruction; the operator did not issue `work`, retry, repair, or task-state commands |
| Wall-clock duration | Approximately 9 minutes 44 seconds from session creation (`19:34:45Z`) to agent leave (`19:44:29Z`); planning through final block was approximately 5 minutes 49 seconds |

## Usage metadata

| Evidence | Value |
| --- | --- |
| Available provider usage metadata | Control-session model `gpt-5.6-sol`: 5 metered assistant messages, 9,324 input tokens, 234 output tokens, 16,896 cached-read tokens, 0 cached-write tokens, reported cost `$0.062088`. Per-worker usage was not observable in retained state. Profile models were planner/reviewer `openai-codex/gpt-5.6-sol`, worker `openai-codex/gpt-5.6-terra`, and analyst `openai-codex/gpt-5.6-luna`; reviewer and analyst execution was not observed. |

## Evidence

- [x] Deliberately reviewed and sanitized excerpt created under ignored `evals/runs/` before cleanup: none; this compact record was derived from task JSON, feed events, Git history, verifier output, and aggregate session usage.
- [x] Secret review: no raw session transcript, credentials, provider secrets, `auth.json`, `models-store.json`, or runtime configuration is committed in this result.

## Comparability

- [x] Deviations affecting comparison validity: the operator did not issue the planned explicit `work` command because stock execution began immediately after planning despite `autoWork: false`; only two task workers overlapped rather than the configured three; all tasks ended blocked despite passing implementations; no implementation review occurred. These deviations are the observed stock baseline behavior and must be compared explicitly rather than normalized away.

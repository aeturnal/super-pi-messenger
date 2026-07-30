# Superpowers integration MVP acceptance

**Status:** `PASSED`

This result contains only reviewed, sanitized evidence. Prior diagnostic,
authentication-failed, interrupted, and reset runs are excluded from the
acceptance decision.

## Run identity

| Evidence | Value |
| --- | --- |
| Date and operator | 2026-07-30; human operator |
| Repository commit | `0d77c4b22960623595e4040b6c54798ff431b532` |
| Package version and root | Superpowers `6.2.0`; `/home/dominic/.pi/agent/git/github.com/obra/superpowers` |
| Active run worktree | `/home/dominic/projects/super-pi-messenger/.worktrees/superpowers-integration-mvp/evals/runs/integration-mvp/worktree` |
| Inactive run worktree | `/home/dominic/projects/super-pi-messenger/.worktrees/superpowers-integration-mvp/evals/runs/integration-mvp/inactive-worktree` |

## Acceptance outcomes

| Check | Outcome and evidence |
| --- | --- |
| Active status and selected paths | **PASS.** Crew reported active Superpowers `6.2.0`. Worker guidance selected `/home/dominic/.pi/agent/git/github.com/obra/superpowers/skills/test-driven-development/SKILL.md` and `/home/dominic/.pi/agent/git/github.com/obra/superpowers/skills/verification-before-completion/SKILL.md`; reviewer guidance selected the latter verification skill. |
| Deterministic verifier | **PASS.** `node evals/scripts/verify-integration-mvp.mjs evals/runs/integration-mvp/worktree` returned `{"status":"passed"}`. It verified repository integrity, committed implementation `14b327b`, final fixture tests, `task-1` state `done`, distinct worker/reviewer traces, required skill/tool calls, one worktree, and absence of forbidden nested calls. |
| Tests-first ordering (human raw-trace review) | **PASS.** The worker read stock TDD and verification plus fixture `project-style`, ran `npm test` and observed four expected failures, edited only `src/clamp.mjs`, then ran fresh tests with four passes before committing and calling `task.done`. Human operator confirmed the chronology. |
| Reviewer natural-language verdict quality (human raw-trace review) | **PASS.** One reviewer read stock verification guidance, inspected the PRD, implementation, tests, task evidence, and commit, ran fresh tests, and returned `SHIP` with specific reasoning covering the named export, range behavior, `RangeError`, scope, and RED/GREEN evidence. Human operator confirmed the verdict quality. |
| Unrelated fixture `project-style` skill access | **PASS.** The worker read `.pi/skills/project-style/SKILL.md` before implementation and preserved the named export without adding a default export. |
| Project Crew agent override preservation regressions | **PASS.** `tests/crew/superpowers-launch.test.ts` active, inactive, and fallback regressions passed within the fresh 601-test project suite. |
| Silent inactive acceptance status | **PASS.** The isolated run completed 1/1 tasks and Crew reported `Superpowers integration: inactive`. Reviewed artifacts and feed contained no fallback warning, selected Superpowers guidance, or stock TDD/verification read. Human operator confirmed the inactive result. |
| Native Crew task and tests | **PASS.** Active and inactive runs each committed the fixture `clamp` implementation, reached `task-1: done`, passed all four fixture tests, and received one final `SHIP` review. The project suite separately passed 601/601 tests with TypeScript and diff checks clean. |

## Supervision and evidence

| Evidence | Value |
| --- | --- |
| Human interventions | The human launched and supervised both accepted runs without intervening in worker/reviewer execution. In the control session, the model called `status` and `work` after `join` without a separate user work request; `join` itself did not start work. This UX observation did not alter worker/reviewer evidence. Earlier failed or interrupted attempts were reset and excluded. |
| Model usage, when available | Control and reviewer: `openai-codex/gpt-5.6-sol`; worker: `openai-codex/gpt-5.6-terra`. |
| Sanitized evidence locations | This file. |
| Raw traces retained only under ignored `evals/runs/` | **Yes.** Accepted active traces are under `evals/runs/integration-mvp/worktree/.pi/messenger/crew/artifacts/`; inactive traces are under `evals/runs/integration-mvp/inactive-worktree/.pi/messenger/crew/artifacts/`. |
| Secret and transcript review | **PASS.** Only bounded tool chronology, model metadata, status, and verdict excerpts were retained here. No credentials or provider secrets were copied. The isolated credential directory was deleted and cleanup was confirmed. |

## Reviewer decision

- [x] Active acceptance reviewed: **PASS**, human operator with sanitized trace evidence.
- [x] Silent inactive acceptance reviewed: **PASS**, human operator with inactive status and artifact evidence.
- [x] Overall acceptance recorded: **PASSED** because the deterministic verifier, both human raw-trace judgments, active behavior, silent inactive behavior, full project suite, and credential cleanup all passed.

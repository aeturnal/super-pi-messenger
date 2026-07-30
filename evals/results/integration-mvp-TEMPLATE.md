# Superpowers integration MVP acceptance

**Status:** `NOT RUN` | `INCOMPLETE` | `FAILED` | `PASSED`

Use `not observable` for unavailable facts. Include only evidence that was
reviewed and sanitized. Silent inactive acceptance requires an inactive result
with no warning. Overall `PASSED` requires the deterministic verifier and both
human raw-trace judgments below to pass.

## Run identity

| Evidence | Value |
| --- | --- |
| Date and operator | <ISO-8601 date; operator> |
| Repository commit | <commit> |
| Package version and root | <version; absolute package root> |
| Active run worktree | <path> |
| Inactive run worktree | <path> |

## Acceptance outcomes

| Check | Outcome and evidence |
| --- | --- |
| Active status and selected paths | <active; detected version; exact worker and reviewer methodology paths> |
| Deterministic verifier | <pass/fail/not run; repository integrity, committed implementation, final tests, task state, required tool calls, and forbidden calls evidence> |
| Tests-first ordering (human raw-trace review) | <pass/fail/not observable; evidence> |
| Reviewer natural-language verdict quality (human raw-trace review) | <pass/fail/not observable; evidence> |
| Unrelated fixture `project-style` skill access | <pass/fail/not observable; details> |
| Project Crew agent override preservation regressions | <pass/fail/not run; `tests/crew/superpowers-launch.test.ts` active/inactive/fallback evidence> |
| Silent inactive acceptance status | <inactive result; warning absent/present> |
| Native Crew task and tests | <pass/fail/not run; details> |

## Supervision and evidence

| Evidence | Value |
| --- | --- |
| Human interventions | <none/details> |
| Model usage, when available | <details/not observable> |
| Sanitized evidence locations | <paths/none> |
| Raw traces retained only under ignored `evals/runs/` | <yes/no> |
| Secret and transcript review | <pass/fail/not performed> |

## Reviewer decision

- [ ] Active acceptance reviewed: <decision and reviewer>
- [ ] Silent inactive acceptance reviewed: <decision and reviewer>
- [ ] Overall acceptance recorded: <decision and rationale>

# Superpowers integration MVP acceptance

**Status:** `NOT RUN` | `INCOMPLETE` | `FAILED` | `PASSED`

Use `not observable` for unavailable facts. Include only evidence that was
reviewed and sanitized. Silent inactive acceptance is a no-warning run;
fallback is a separate warning state and does not satisfy it.

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
| Active task and deterministic tests | <pass/fail/not run; details> |
| Forbidden calls | <none/details/not observable> |
| Project skill and override behavior | <pass/fail/not run; details> |
| Reviewer outcome | <pass/fail/not run; details> |
| Silent inactive acceptance status | <inactive result; warning absent/present> |
| Native Crew task and tests | <pass/fail/not run; details> |
| Inactive project override behavior | <unchanged/changed/not observable; details> |

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

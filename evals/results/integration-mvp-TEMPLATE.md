# Superpowers integration MVP acceptance

**Status:** `NOT RUN` | `INCOMPLETE` | `FAILED` | `PASSED`

Use `not observable` for unavailable facts. Include only evidence that was
reviewed and sanitized.

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
| Active status and selected paths | <active/inactive; version; worker and reviewer paths> |
| Active task and deterministic tests | <pass/fail/not run; details> |
| Forbidden calls | <none/details/not observable> |
| Project skill and override behavior | <pass/fail/not run; details> |
| Reviewer outcome | <pass/fail/not run; details> |
| Inactive fallback status | <inactive result; warning absent/present> |
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
- [ ] Inactive fallback reviewed: <decision and reviewer>
- [ ] Overall acceptance recorded: <decision and rationale>

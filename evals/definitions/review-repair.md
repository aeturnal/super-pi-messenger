# Eval: review and scoped repair

## Purpose

Define the Phase 3 evaluation of review and repair lifecycle behavior. Its fixture is built immediately before repair-lifecycle work.

## Fixed lifecycle and ownership

The future fixture begins with a completed task commit for `mergeSettings(defaults, overrides)`. It returns expected merged values but mutates caller-owned defaults despite an explicit immutability requirement; visible task tests omit that regression.

1. Review the completed task-owned commit.
2. Expect the reviewer to find mutation and return `NEEDS_WORK` while the core design remains sound.
3. Dispatch one scoped repair owning the relevant implementation and regression test.
4. Require the repair to preserve the core approach, avoid unrelated changes, and add mutation coverage.
5. Re-review repair-owned changes plus a concise design sanity check.
6. Expect deterministic acceptance to pass.

## Acceptance

The future product target fails if review misses mutation, restarts the complete task, launches more than one routine repair, bypasses regression coverage, ignores design validity on re-review, or observes nested orchestration. The scoped repair and its review must retain the stated ownership boundaries.

## Observations to record

Record reviewer findings and verdict, repair count and scope, retries, review cycles, interventions, task and integration review scope, nested orchestration, worker overlap, reservation conflicts, duration, and available provider usage metadata. A stock baseline that lacks this lifecycle is recorded as such, not emulated through undocumented manual steps.

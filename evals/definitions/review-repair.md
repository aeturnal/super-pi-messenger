# Eval: review and scoped repair

## Purpose

Define the Phase 3 evaluation of review and repair lifecycle behavior. Its fixture is built immediately before repair-lifecycle work.

## Fixed task

The future fixture begins with a completed task commit for `mergeSettings(defaults, overrides)`. It returns expected merged values but mutates caller-owned defaults despite an explicit immutability requirement; visible task tests omit that regression.

## Fixture boundary

The completed seed commit, its task-owned change, and the caller-mutation defect are fixed. The scoped repair owns only the relevant implementation and regression test; unrelated changes are outside the boundary.

## Procedure

1. Review the completed task-owned commit.
2. Expect the reviewer to find mutation and return `NEEDS_WORK`. NEEDS_WORK is eligible only when the core design remains sound; architectural uncertainty requires `MAJOR_RETHINK`.
3. Dispatch one scoped repair. If it fails, one failed scoped repair escalates rather than repeats.
4. Require the repair to preserve the core approach, avoid unrelated changes, and add mutation regression coverage.
5. The reviewer must re-review the repair-owned changes and perform a concise design sanity check.
6. Expect deterministic acceptance to pass.

## Deterministic acceptance

The future product target fails if review misses mutation, restarts the complete task, launches more than one routine repair, bypasses regression coverage, ignores design validity on re-review, or observes nested orchestration. Nested orchestration is prohibited. The scoped repair and its review retain the stated ownership boundaries.

## Supervised observations

Record reviewer findings and verdict, repair count and scope, sessions by role, retries, review cycles, human interventions, task and integration review scope, nested orchestration, worker overlap, reservation conflicts, wall-clock duration, and available provider usage metadata.

## Product target versus stock baseline

A stock baseline that lacks this lifecycle is recorded honestly, not emulated through undocumented manual steps. The fixture is deferred to Phase 3.

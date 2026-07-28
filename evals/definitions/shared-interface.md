# Eval: shared exported interface

## Purpose

Define the Phase 2 evaluation of parallel codecs sharing an existing canonical record contract. Its fixture is built immediately before Phase 2 review-scope work.

## Fixed task

A dependency-free record-codec library supplies an existing canonical record contract. Parallel workers implement a CSV codec and a JSON-lines codec against that contract without modifying it.

## Fixture boundary

Each task owns only its codec and task-specific tests. The shared canonical record contract is immutable to both tasks. Cross-codec behavior is integration acceptance, not a substitute for either codec's task tests.

## Procedure

Task review sees only task-owned changes. A separate integration review examines shared-contract interaction after both codec tasks are complete. The fixture is deferred to Phase 2; this fixed definition is not changed when it is built.

## Deterministic acceptance

- Both codecs emit and consume the canonical record shape.
- Cross-codec round trips pass integration acceptance.
- Contract mismatches are not considered covered merely because isolated codec tests pass.
- The shared contract is not modified by either task.
- The separate integration review explicitly covers the shared interface.

## Supervised observations

Record task decomposition, task review scope, integration review outcome, nested orchestration, retries, interventions, review cycles, worker overlap, reservation conflicts, and available provider usage metadata. Record any deviation or unavailable observation honestly.

## Product target versus stock baseline

A stock baseline that cannot provide the required integration review is recorded as such; it is not treated as satisfying the future product target.

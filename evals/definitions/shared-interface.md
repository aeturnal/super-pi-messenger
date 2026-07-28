# Eval: shared exported interface

## Purpose

Define the Phase 2 evaluation of parallel codecs sharing an existing canonical record contract. This definition is fixed now; its fixture is built immediately before Phase 2 review-scope work.

## Fixed lifecycle and ownership

A dependency-free record-codec library supplies an existing canonical record contract. Parallel workers implement a CSV codec and a JSON-lines codec against that contract without modifying it. Each task owns only its codec and task-specific tests. Task review sees only task-owned changes; a separate integration review examines shared-contract interaction.

## Acceptance

- Both codecs emit and consume the canonical record shape.
- Cross-codec round trips pass integration acceptance.
- Contract mismatches are not considered covered merely because isolated codec tests pass.
- The shared contract is not modified by either task.
- The integration review explicitly covers the shared interface.

## Observations to record

Record task decomposition, task review scope, integration review outcome, nested orchestration, retries, interventions, review cycles, worker overlap, reservation conflicts, and available provider usage metadata. Record any deviation or unavailable observation honestly.

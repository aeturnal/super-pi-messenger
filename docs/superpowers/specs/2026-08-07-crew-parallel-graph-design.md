# Crew-Owned Parallel Graph Design

## Goal

Let Crew turn a sequentially presented Superpowers implementation plan into a safe parallel task graph. Preserve real dependencies and strict scheduling without treating task numbering or document order as execution order.

## Confirmed Failure

The current handoff run ended with `no tasks parsed`. Its result invited manual task creation. The controller then created implementation-review pairs as one strict chain. Because strict dependency mode was working correctly, configured concurrency could not start more than one task.

The planner prompt already asks for a parallel graph, but the result has no bounded format repair and no structural check for a needless linear chain.

## Ownership Boundary

The exact Superpowers plan remains the source of requirements. Crew owns dependency compilation, task dispatch, and automatic review dispatch.

Numbered Superpowers tasks are presentation order only. TDD, verification, and task review remain requirements inside each task, but they do not create a global implementation-review-implementation sequence.

The outer compatibility policy will state that the controller must not manually recreate or serialize Crew tasks when Crew planning fails. Crew either creates a valid graph or fails safely for the user to retry or revise.

## Planner Rules

Update the planner instructions with these rules:

- Add a dependency only when the consumer needs a concrete file, symbol, schema, migration, or verified behavior from the provider.
- State the concrete reason in the task description.
- Do not infer a dependency from task number, document order, or generic “next” wording.
- Minimize the critical path while preserving real dependencies.
- Return the existing `tasks-json` schema exactly.

No new public action, task schema, dependency mode, or persisted dependency-reason metadata is added.

## Minimal Validation and Repair

Perform validation on parsed planner tasks before creating any stored tasks.

Reject:

- unresolved dependency titles;
- self-dependencies;
- dependency cycles.

Add two bounded repair paths:

1. **Format repair:** When neither the JSON block nor markdown fallback yields tasks, ask the planner once to return the same plan using the exact existing `tasks-json` format.
2. **Linear-graph reconsideration:** When four or more tasks form one complete chain, ask the planner once to remove unsupported edges and expose safe parallel branches, or retain the chain with a concrete reason for every edge.

The repair prompts receive the exact source plan and prior planner output. They may restructure execution but may not change requirements.

If repaired output is still unparseable or structurally invalid, planning fails before task creation. It must not invite the controller to create tasks manually. A structurally valid linear graph returned after the required reconsideration is accepted because some work is genuinely sequential; retained-edge reasons remain visible in task descriptions for human review.

The implementation may use small pure helpers for dependency resolution, cycle detection, and complete-chain detection. It does not add general graph scoring, arbitrary percentage thresholds, or automatic edge deletion.

## Execution

Keep strict dependency behavior unchanged. The existing scheduler already launches all currently ready tasks up to configured concurrency. A better graph therefore produces parallel implementation waves without a scheduler rewrite.

Keep the current automatic review lifecycle unchanged for this correction. Crew remains the sole automatic review dispatcher, and the controller does not insert separate review tasks to serialize independent implementation work.

## Example

The current seven-task handoff plan can be represented approximately as:

```text
Task 1
  ├── Task 2
  └── Task 3

Tasks 2 and 3 complete:
  ├── Task 4
  ├── Task 5
  └── Task 7

Task 5 complete:
  └── Task 6
```

This permits parallel waves while retaining strict dependencies.

## Tests

Add focused tests proving:

- numbered independent tasks become independent roots;
- concrete dependencies remain intact;
- malformed planner output receives one format repair;
- a complete chain of four or more tasks receives one reconsideration;
- a justified complete chain is accepted;
- a repaired branched graph creates parallel-ready roots;
- unresolved titles, self-dependencies, cycles, and repeated malformed output create no tasks;
- planning failure does not instruct the controller to create tasks manually;
- existing strict scheduling launches all ready tasks up to concurrency;
- the outer Superpowers policy assigns execution and review dispatch to Crew without imposing document order.

Existing planning, strict dependency, approval, cancellation, retry, and automatic review tests must continue to pass.

## Scope

This design does not add advisory dependencies, interface-ready states, dependency metadata persistence, graph observability, dynamic slot refilling, concurrent review scheduling, or a new scheduler. It does not modify stock Superpowers files.

Communication restoration is implemented first so parallel workers can coordinate safely.

# Crew-Owned Parallel Graph Design

## Goal

Let Crew translate a sequentially presented Superpowers implementation plan into a safe parallel dependency graph. Preserve strict real dependencies, task-level Superpowers methods, and review gates without turning numbering or document order into a global chain.

## Current Failure

The current deterministic handoff run did not receive a usable task graph from the Crew planner. Planning ended with `no tasks parsed`. The controller then manually created tasks and inserted implementation-review pairs into one strict chain. With project configuration set to strict dependencies, concurrency three could not start more than one task.

The packaged planner prompt already asks for a parallel graph, but this is prompt guidance only. There is no structural quality gate for unjustified serialization, no required reason for each dependency, and no bounded format-repair path when `tasks-json` is missing or malformed.

## Ownership Boundary

The Superpowers plan remains the exact source of requirements and task detail. Crew owns execution order, dependency compilation, dispatch, and review scheduling.

Numbered headings such as `Task 1`, `Task 2`, and `Task 3` are presentation order only. Crew may reorder and run them concurrently. Superpowers practices such as TDD, verification, and task review remain requirements inside each task; they do not create a global serial executor.

The outer compatibility policy will explicitly forbid the controller from manually converting the plan into an implementation-review-implementation chain. When Crew is available, the controller passes the exact plan to Crew and lets Crew compile and execute the graph.

## Hard Dependency Rules

Crew may create a hard dependency only when the consumer:

- imports or calls code, types, or files produced by the provider;
- needs a concrete artifact, schema, migration, or verified behavior from the provider;
- must modify the same files and ownership cannot safely be divided;
- must wait for the provider's review because it consumes that reviewed output.

Task numbering, document order, conceptual preference, and generic phrases such as “after Task 1” are not sufficient by themselves.

Each planner task object keeps `dependsOn` for compatibility and adds `dependencyReasons`, keyed by dependency title. Example:

```json
{
  "title": "Persist workspace identity",
  "dependsOn": ["Resolve linked-worktree identity"],
  "dependencyReasons": {
    "Resolve linked-worktree identity": "Imports WorkspaceIdentity from crew/types.ts"
  }
}
```

After title-to-ID resolution, Crew persists the reasons keyed by task ID. Status and task inspection can explain why an edge exists. Missing or unresolved dependency names remain invalid planner output.

## Graph Analysis

Add a small pure graph-analysis module. Given parsed tasks, it reports:

- root task count;
- topological waves;
- maximum wave width;
- critical-path length;
- cycles and unresolved edges;
- dependencies lacking concrete reasons.

A graph is suspiciously serial when it has at least four tasks and its critical path contains at least 80 percent of all tasks while no wave is wider than two tasks. A fully linear graph is always suspicious at four or more tasks.

The analyzer never deletes dependencies. It supplies evidence to a planner repair pass and rejects cycles or unresolved edges.

## Bounded Planner Repair

Planning has two independent, bounded repair opportunities:

1. **Format repair:** If the planner omits or malforms the `tasks-json` block, make one focused request containing the existing output and exact schema. The repair may change formatting but not requirements.
2. **Graph repair:** If the parsed graph is suspiciously serial or lacks dependency reasons, make one focused request to remove unsupported edges, split independent work streams, and justify retained edges.

A repaired serial graph is accepted when every retained edge has a concrete reason. This permits genuinely sequential work. If output remains malformed, cyclic, unresolved, or unjustified after its repair opportunity, planning fails before creating any tasks. Crew never persists a partial graph and never silently falls back to a different plan.

Repair passes are validation work and do not consume the configured general planning review pass count.

## Strict Parallel Scheduling

Strict dependency mode remains the default and remains authoritative. Crew does not implement global advisory scheduling or ignore declared dependencies.

All ready tasks launch up to the configured worker concurrency. When one task completes, its review can begin without waiting for unrelated workers in the same wave. Workers already running continue during that review.

When required automatic review is enabled, worker completion sets an internal review state to `pending`. The task may display as implemented, but it does not satisfy dependencies until review changes that state to `accepted`. With review disabled, completion immediately satisfies dependencies as it does today. Retry and block outcomes clear the pending gate while applying their existing task status changes.

After a task receives an accepted review, newly ready dependents may fill an available worker slot even if unrelated work or reviews remain active. A failed review resets or blocks only that task and therefore only its true downstream dependents.

This requires replacing the current whole-wave worker barrier followed by a sequential review loop with bounded per-task completion handling. The total number of active implementation workers remains within `concurrency.workers`. Concurrent reviews are bounded by the number of completed tasks from that worker set, which cannot exceed the configured worker concurrency.

State changes remain serialized through existing task-store operations. Result reporting is collected deterministically by task ID even when completion order differs.

## Review Behavior

Crew remains the sole review dispatcher.

- Independent completed tasks may be reviewed concurrently.
- A task is not considered dependency-ready until its required automatic review ships.
- `NEEDS_WORK` resets only the reviewed task for retry.
- `MAJOR_RETHINK` blocks only the reviewed task and its dependents.
- Missing or failed required review remains a safe block, as today.
- The controller does not create separate review tasks solely to serialize the plan.

## Example

The deterministic handoff plan can compile to:

```text
Task 1
  ├── Task 2
  └── Task 3

Tasks 2 and 3 accepted:
  ├── Task 4
  ├── Task 5
  └── Task 7

Task 5 accepted:
  └── Task 6
```

Tasks 2 and 3 may run together because they consume Task 1 but not each other. Tasks 4, 5, and 7 may run together when their concrete inputs are available. Task 6 waits only for Task 5.

## Observability

Planning results and status output will include a compact graph summary:

```text
Graph: 7 tasks, roots 1, waves 4, max width 3, critical path 4
```

If a serial graph is retained after repair, planning output states that its dependencies were explicitly justified. Feed events distinguish format repair and graph repair so extra model work is visible.

## Tests

Add focused tests for:

- numbered tasks with no concrete relationship becoming independent roots;
- concrete file, symbol, schema, and review dependencies being retained;
- missing dependency reasons triggering one graph repair;
- a fully serial but justified graph being accepted after reconsideration;
- malformed `tasks-json` receiving one format repair;
- malformed repaired output failing without partial task creation;
- cycle and unresolved-title rejection;
- graph metrics for branched and linear DAGs;
- multiple ready tasks launching up to configured concurrency;
- a completed task entering review while an unrelated worker remains active;
- independent reviews running concurrently;
- accepted reviews releasing only their dependents;
- failed reviews not stopping unrelated branches;
- the outer Superpowers policy assigning graph and review scheduling to Crew.

Planner and scheduler tests must use deterministic mocked child results. Existing strict dependency, approval, retry, durable provider failure, cancellation, and review-limit tests must continue to pass.

## Scope

This design does not add advisory dependencies, interface-ready task states, a new public planning action, or automatic dependency deletion. It does not modify stock Superpowers files. It does not permit nested agents or alternate review dispatchers.

Communication restoration is a prerequisite because parallel workers need mesh registration, direct messages, and broadcasts to coordinate safely.

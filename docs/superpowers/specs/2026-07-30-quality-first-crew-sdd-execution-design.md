# Quality-First Crew Execution for Superpowers SDD — Design

**Date:** 2026-07-30  
**Status:** Proposed for user review

## Priorities

This integration optimizes for, in order:

1. high implementation quality;
2. reliable unattended completion;
3. reasonable token cost; and
4. opportunistic wall-clock improvement when safe parallel work exists.

Keeping every configured worker slot occupied is not a goal. Configured concurrency is capacity, not a utilization target.

## Problem

The packaged Superpowers compatibility policy authorizes Crew when stock Superpowers v6 `subagent-driven-development` (SDD) applies, but it does not precisely define how SDD's dispatcher mechanics translate to Crew.

In an observed Plan 03 run, the controlling agent followed stock SDD literally by:

- forcing every `work` call to `concurrency: 1`;
- creating separate implementation and review meta-tasks;
- globally chaining each implementation behind the previous review; and
- manually driving one Crew wave per meta-task.

Stock SDD does explicitly prohibit parallel implementation subagents and requires a fresh implementer, independent review, and repair before continuing. The response explaining that behavior was therefore grounded in the stock skill.

However, reproducing SDD's dispatcher as Crew tasks duplicated functionality Crew already owns. Crew has fresh workers, automatic task review, repair/reset behavior, a dependency graph, and a configurable worker pool. The duplicated meta-task chain increased orchestration state and controller work without improving the review guarantee.

Plan 03 also contained real interface and shared-file dependencies, so mostly sequential implementation was not itself necessarily a defect. The defect was treating global serialization and explicit review meta-tasks as required Crew translations for every plan.

## Product Principle

When official validated Superpowers v6 is active and the controlling Pi agent determines SDD applies, Crew replaces SDD's dispatcher while preserving SDD's quality methodology.

The translation is:

- SDD fresh implementer → one fresh Crew worker per implementation task;
- SDD task review → Crew's native automatic reviewer;
- SDD repair loop → Crew's existing review reset/block/retry behavior;
- SDD task ordering → Crew's task dependency graph under strict enforcement;
- SDD controller → the controlling Pi agent supervising Crew, not spawning another dispatcher;
- SDD parallel-subagent prohibition → safe, opportunistic Crew concurrency only among dependency-independent tasks.

The integration does not attempt to keep multiple implementation workers active when the plan has only one safe ready task.

## Execution Semantics

### Strict dependency gates

SDD-integrated runs use strict dependency enforcement:

- a task is ready only when every declared dependency is done;
- a dependent does not start against an unfinished predecessor;
- Crew completes automatic review before the next autonomous wave is scheduled;
- `NEEDS_WORK` resets the predecessor, keeping dependents ineligible;
- `MAJOR_RETHINK` blocks the predecessor and therefore its dependents; and
- `SHIP` leaves the predecessor done, allowing dependents to become ready.

This makes task dependencies actual quality gates rather than coordination hints.

### Opportunistic parallelism

Within the set of strictly ready tasks, Crew may run tasks concurrently up to configured concurrency.

Parallel execution is appropriate only when tasks have no hard dependency relationship and can safely share the assigned checkout. Typical indicators include disjoint files, stable interfaces already fixed by the plan, and independent acceptance tests.

Crew must not:

- remove real dependencies to fill worker slots;
- start dependent tasks speculatively against unfinished interfaces;
- force concurrency above the user's configured value; or
- imply that a worker limit of two guarantees two active workers.

A tightly coupled plan may correctly run one implementation worker at a time.

### Native review lifecycle

The controlling agent must rely on Crew's automatic review lifecycle for normal implementation tasks.

It must not create separate `Implement Task N` and `Review Task N` Crew tasks merely to imitate stock SDD. Review and repair are lifecycle states of the implementation task, not separate plan deliverables.

Explicit review tasks remain valid only when review itself is a genuine project deliverable distinct from Crew's implementation quality gate.

### Plan quality

The planner should produce the smallest truthful dependency graph:

- dependencies represent real data or ordering requirements;
- conceptual ordering alone is not a dependency;
- independent work streams remain independent;
- tasks sharing an evolving interface remain ordered unless the interface is already fixed; and
- tests remain with the implementation they verify.

The controller should not rewrite a valid DAG into a total order merely because SDD is active. It also should not rewrite a genuinely sequential plan to manufacture concurrency.

## Runtime Mechanism

A prompt-only promise is insufficient because Crew currently defaults to advisory dependency handling. The product needs a small per-run dependency override using the existing `strict` and `advisory` concepts.

### Tool contract

Add an optional `dependencies: "strict" | "advisory"` parameter to the relevant Crew execution actions:

- `plan` records the run's effective dependency mode for planned and automatic work;
- `work` may explicitly set or preserve the run's effective mode; and
- autonomous waves retain the selected mode.

For SDD translation, the package-owned outer policy instructs the controlling agent to select `dependencies: "strict"`.

This is a per-run execution choice, not a new user configuration field. It must not rewrite user or project configuration files. Normal non-SDD Crew behavior continues to use existing configuration when no override is supplied.

### Stored state

The effective dependency mode belongs to the Crew plan/run state so automatic work, autonomous continuation, status, resumed work, and lobby-backed assignment agree on the same semantics. Every task-readiness path must resolve the stored run override before falling back to configured dependency mode; otherwise a dependent could bypass the strict gate through a secondary dispatch path.

Only the selected existing enum value is stored. No provider registry, workflow engine, generalized policy framework, migration system, or compatibility layer is introduced.

### Status visibility

Crew status should show the effective dependency mode when a plan exists. This makes unattended behavior inspectable and prevents an apparent concurrency problem from being misdiagnosed when only one strict-ready task exists.

## Package-Owned Policy

Strengthen `crew/superpowers-policy.ts` to tell the controlling agent:

- use strict dependency enforcement for SDD-integrated Crew runs;
- preserve configured concurrency as the maximum worker capacity;
- allow dependency-independent ready tasks to run concurrently;
- accept sequential execution when only one task is safely ready;
- use Crew's native automatic per-task review and repair;
- do not construct implementation/review meta-task chains solely to imitate SDD;
- do not select `concurrency: 1` solely because stock SDD is active; and
- do not speculate across genuine dependencies merely to increase parallel utilization.

The policy may explicitly state that stock SDD's absolute prohibition on parallel implementers is superseded only for Crew-managed, dependency-independent tasks.

Existing guarantees remain unchanged:

- Superpowers owns methodology outside Crew.
- Crew is the sole implementation and review dispatcher.
- No nested agents, alternative dispatchers, plan executors, branch-finishing workflows, or nested worktree management may start.
- Unrelated Crew use still requires explicit user authorization.
- Injection remains gated by validated official Superpowers v6 provenance.
- Crew children never retain the controlling-agent outer policy.

## Expected Flow

For a graph where Tasks B and C independently depend on Task A:

1. Crew runs A with a fresh worker.
2. Crew automatically reviews A.
3. If A is accepted, B and C become strict-ready.
4. With configured concurrency two, Crew may run B and C concurrently.
5. Crew independently reviews each result.
6. A dependent of B becomes ready only after B is accepted.
7. Failure or repair of C does not globally invalidate accepted B unless the plan declares a dependency.

For a linear graph A → B → C, one worker at a time is the correct result regardless of configured concurrency.

## Token Discipline

Parallelism does not inherently reduce token usage. This design controls token cost by:

- avoiding duplicate review meta-tasks and controller bookkeeping;
- avoiding speculative dependent work likely to require rework;
- preserving focused task prompts and fresh worker context;
- using Crew's existing single automatic reviewer per completed task;
- retaining model selection by role; and
- not dispatching idle work solely to occupy capacity.

This design does not remove per-task review because that review is central to the quality objective.

## Testing

### Dependency override tests

Add focused tests proving:

- `plan` and `work` accept only `strict` or `advisory` overrides;
- an omitted override preserves current configuration behavior;
- an SDD-style strict run excludes tasks with unfinished dependencies;
- independent strict-ready tasks are still passed to the worker pool together;
- the effective mode persists across automatic/autonomous continuation and resume;
- all normal and lobby-backed readiness paths honor the same effective mode; and
- status reports the effective mode.

### Review-gate tests

Verify under strict mode:

- a dependent is not included in the same wave as its unfinished predecessor;
- `SHIP` allows the dependent in the next wave;
- `NEEDS_WORK` keeps the dependent waiting; and
- `MAJOR_RETHINK` leaves the dependent unavailable.

Existing automatic review and concurrency tests should be reused where possible rather than duplicated.

### Policy tests

Extend policy tests to assert guidance for:

- strict SDD dependency enforcement;
- opportunistic independent-task concurrency;
- configured concurrency as a ceiling;
- native automatic review instead of meta-task chains; and
- acceptance of legitimate sequential execution.

Existing active-state, fallback, child-exclusion, lifecycle, and idempotence coverage remains required.

### Behavioral acceptance

Run fresh controlling-agent checks against the installed package:

1. Two independent strict-ready tasks with concurrency two may run concurrently.
2. A dependent task waits for predecessor acceptance.
3. A linear plan is correctly described as sequential rather than a concurrency failure.
4. The controller chooses native Crew review rather than creating review meta-tasks.
5. When SDD does not apply and the user did not request Crew, Crew does not start.

Behavioral checks supplement deterministic repository tests; they do not replace them.

## Documentation

Update README to explain:

- quality-first SDD translation;
- strict dependency gates for SDD runs;
- native task reviews;
- opportunistic rather than guaranteed parallelism; and
- the distinction between configured capacity and current ready-task count.

Update CHANGELOG with the corrected execution semantics.

## Non-Goals

This change will not:

- modify stock Superpowers;
- maximize worker utilization;
- introduce soft dependency edges;
- speculate against unfinished interfaces;
- infer file conflicts automatically;
- isolate each task in a separate branch or worktree;
- force concurrency above configured limits;
- remove automatic task review;
- add a generic workflow or policy engine; or
- fix checkout-root or premature assignment when `autoWork: false`.

The observed wrong-checkout and premature-lobby-assignment incident is a separate reliability defect. This design requires existing lobby-backed dispatch to honor the selected dependency mode, but it does not otherwise redesign when lobby workers start or which checkout they inherit.

## Success Criteria

The change is successful when:

- SDD-integrated work uses strict dependency gates without mutating user configuration;
- Crew may use configured concurrency for genuinely independent ready tasks;
- legitimate sequential plans remain sequential without being treated as failures;
- the controller no longer creates redundant implementation/review meta-task chains;
- automatic review outcomes correctly govern downstream readiness;
- effective dependency behavior is visible in status;
- non-SDD Crew behavior remains backward compatible; and
- focused tests, the full repository suite, TypeScript, independent review, required GitHub CI, and supervised acceptance pass.

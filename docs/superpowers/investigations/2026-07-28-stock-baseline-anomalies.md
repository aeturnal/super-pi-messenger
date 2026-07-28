# Stock baseline orchestration anomaly investigation

**Date:** 2026-07-28  
**Baseline:** `npm:pi-messenger@0.14.1`, independent-parallel fixture  
**Status:** Investigation complete; no production fixes made

## Purpose

This report investigates four orchestration anomalies recorded in `evals/results/stock-pi-messenger-0.14.1-independent-parallel.md`:

1. work began despite `autoWork: false`;
2. successful worker commits were retried and ultimately marked blocked;
3. configured concurrency three produced at most two overlapping workers; and
4. no task or integration reviews occurred.

The investigation uses the retained fixture state, task files, progress files, feed events, Git history, deterministic verifier output, the pinned profile, and source paths matching stock tag `v0.14.1`. Raw worker/control transcripts were not retained, so this report distinguishes durable facts from inference and does not infer private model reasoning.

## Executive conclusion

The four symptoms are explained by two shared controller defects and one missing stock capability:

1. **The planning overlay bypasses the `autoWork` decision and the normal work controller.** It starts workers whenever planning changes from active to complete and refills slots on later renders. This explains unauthorized work, the two-worker ceiling, retry ordering, and the absence of the normal work controller's automatic review hook.
2. **Worker launchers remove `pi_messenger` from the `--tools` allowlist.** Workers receive instructions requiring `task.done`, but the generated process arguments retain only built-in tool names. With the pinned Pi tool-selection behavior, loading the extension does not restore an extension tool excluded by `--tools`. This explains why workers could edit, test, and commit but could not perform the authoritative completion transition.
3. **Stock v0.14.1 has no integration-review lifecycle.** It supports plan and task implementation review only. Integration review therefore could not occur even in a successful run.

These conclusions do not justify treating exit code zero or the presence of a commit as task completion. `task.done` remains the fail-closed authoritative transition.

## Durable baseline facts

- The profile sets `concurrency.workers: 3`, `concurrency.max: 3`, `review.enabled: true`, `review.maxIterations: 1`, and `work.maxAttemptsPerTask: 2`.
- The generated plan and all three task records have no dependencies. The source files are disjoint.
- `plan.done` was recorded at `19:37:19.615Z`; tasks 1 and 2 started 18 ms and 26 ms later.
- No operator `work` command was issued.
- The first attempts produced the three correct implementation commits before their worker processes exited.
- All six immutable functional checks passed, while every final task record was `blocked` with `attempt_count: 2` and `Max attempts (2) reached`.
- The feed contains no `task.done` or review event, and the plan remained at `completed_count: 0`.
- The maximum observed task-worker overlap was two. Task 3 first started 10 ms after task 2 blocked.

Primary retained event evidence is in `evals/runs/independent-parallel/worktree/.pi/messenger/feed.jsonl` and task state under that worktree's `.pi/messenger/crew/` directory.

## Finding 1: `autoWork: false` was bypassed by the overlay

**Confidence:** High

The plan handler behaves correctly in isolation:

- `crew/handlers/plan.ts:505-532` computes `shouldAutoWork = params.autoWork !== false`.
- With explicit false, it reports manual next steps and does not call `setPendingAutoWork`.
- `tests/crew/plan-replan.test.ts:446-463` covers this headless handler behavior.

The interactive overlay has a second, independent completion path:

- `overlay.ts:132-150` detects planning changing from active to inactive and calls `spawnWorkersForReadyTasks` without consulting `autoWork`, pending-auto-work state, or autonomous authorization.
- `overlay.ts:152-173` later refills worker slots whenever the in-progress count falls.
- These methods are invoked during overlay rendering.

The 18–26 ms start timing and the two-worker signature match this path. An explicit `work` call would have synchronized configured concurrency to three before spawning; the overlay did not.

### Rejected or bounded alternatives

- **Dropped/coerced parameter:** rejected by unchanged parameter forwarding and handler tests.
- **Normal pending-auto-work hook:** rejected because explicit false does not set the pending flag; that hook sends a steer rather than directly spawning workers.
- **Control model issued `work`:** not forensically impossible without the raw transcript, but inconsistent with the observed two-worker signature.
- **Stale pending flag:** a separate latent edge case because false does not clear an earlier pending flag, but unlikely in the fresh isolated run and unnecessary to explain the evidence.

## Finding 2: workers could not call the authoritative completion tool

**Confidence:** Very high for the current pinned stack; high for the historical run

The worker contract requires mesh and lifecycle calls, including:

```text
pi_messenger({ action: "task.done", ... })
```

`crew/agents/crew-worker.md` declares `tools: read, write, edit, bash, pi_messenger`. However, both launch paths filter declared tools through `BUILTIN_TOOLS` when generating `--tools`:

- `crew/agents.ts:217-237` for ordinary agents;
- `crew/lobby.ts:83-97` for lobby/direct workers.

`pi_messenger` is an extension tool, not a built-in and not a path, so it is omitted. The launchers separately load the extension, but the pinned Pi 0.82.1 behavior applies the `--tools` allowlist to registered extension tools as well. Thus the extension loads while `pi_messenger` remains unavailable.

This matches the durable signature: workers used built-in file and shell tools to implement and commit, but emitted no join, reservation, progress, release, or completion events.

The exact historical Pi executable version was not persisted, so the historical mechanism cannot be proven with absolute certainty. The relevant launcher files match stock tag `v0.14.1`, and the pinned current Pi behavior deterministically reproduces the capability mismatch.

## Finding 3: exit-zero recovery produced retries and terminal blocks

**Confidence:** High

`task.done` is the authoritative success transition:

- `crew/handlers/task.ts:422-482` accepts completion only from `in_progress`;
- `crew/store.ts:342-370` synchronously stores `done`, evidence, completion time, and plan progress.

The worker close handler is intentionally fail-closed:

- `crew/lobby.ts:170-201` checks whether the owned task is still `in_progress`.
- Below the attempt limit, it resets the task to `todo`.
- At the configured limit, it marks the task blocked.
- Process exit code zero does not override the missing task transition.

Therefore the state outcome is deterministic once `task.done` is absent. Treating a clean process exit or any Git commit as completion would be unsafe because neither proves that the assigned acceptance criteria were met.

## Finding 4: configured concurrency was bypassed and retries starved untouched work

**Confidence:** High

The normal work controller loads `config.concurrency.workers` and writes it to autonomous runtime state before calling `spawnAgents` (`crew/handlers/work.ts:100-110`). The overlay bypasses that controller and instead reads the initial `autonomousState.concurrency`, which is hard-coded to two (`crew/state-autonomous.ts:31-40`).

Consequently, `overlay.ts:132-149` computed a target of two despite the configured value three.

Task ordering then explains why task 3 waited:

- ready tasks are returned in numeric task order;
- `crew/spawn.ts:25-85` repeatedly selects the first currently ready task;
- exited attempts for tasks 1 and 2 became `todo` again;
- refill selected those lower-numbered retries before untouched task 3;
- task 3 started immediately after task 2 finally blocked and released a slot.

Dependencies, file reservations, workload shape, and provider capacity do not explain the observation: all tasks were independent, reservations are not a scheduler gate, and the controller emitted only two initial `task.start` events before any provider-side capacity could matter.

## Finding 5: review absence was overdetermined

**Confidence:** High

### Task review

Automatic task review exists only inside `crew/handlers/work.ts:225-264`, after the normal controller awaits worker results and classifies tasks into `succeeded`.

The overlay/direct spawn path does not call this review hook. Therefore even an overlay-spawned worker that successfully reached `done` could escape automatic review.

In this run, missing completion was independently sufficient to prevent review: every task remained non-successful and ultimately blocked. No reviewer-dispatch or skipped-review event appears in retained progress/feed evidence.

### Integration review

Stock v0.14.1 exposes only plan and implementation review. `crew/handlers/review.ts` contains no integration-review action, state, prompt, or terminal lifecycle dispatch. Integration review was therefore unavailable, not merely skipped because the run ended blocked.

## Deterministic regression requirements

The Phase 1 design should account for these tests without presupposing the final production architecture:

1. **Plan authorization matrix**
   - Simulate planning active → complete with an open overlay.
   - With `autoWork: false`, assert no worker spawn, no `task.start`, and all tasks remain `todo`.
   - With `autoWork: true`, assert exactly one authorized dispatch path.

2. **Configured initial concurrency**
   - Configure workers/max to three with three independent ready tasks.
   - Assert the authorized initial dispatch target is three, not the runtime default two.

3. **Worker tool capability**
   - For ordinary and lobby worker launchers, inspect generated process arguments.
   - Assert the required `pi_messenger` extension tool remains available alongside the selected built-ins.

4. **Exit-zero lifecycle**
   - Exit zero while still `in_progress` must not be classified as success.
   - Attempt one may reset according to policy; the maximum attempt must stop deterministically.
   - Persisting `task.done` before close must preserve `done`.

5. **Retry fairness**
   - With two slots, two retryable tasks, and one untouched ready task, define and test whether untouched work receives priority over repeated attempts.

6. **Task-review dispatch**
   - A task completed through every supported execution path must receive exactly one enabled task review before terminal acceptance.

7. **Integration-review lifecycle**
   - Once all task-scoped reviews pass, require exactly one explicit integration review before the plan is declared complete when configured.

## Scope implications for Phase 1

The `autoWork` bypass, tool capability loss, configured-concurrency bypass, and retry behavior are concrete reliability regressions suitable for deterministic Phase 1 coverage. Integration review itself remains a later PRD phase, but Phase 1 design should avoid cementing lifecycle paths that would prevent its later insertion.

Production fixes are intentionally not selected in this report. The key design decision is whether the overlay may execute work directly or must remain a display/control surface that delegates to one authoritative work lifecycle. That decision belongs in the Phase 1 design.

## Residual unknowns

- Raw worker/control transcripts were deliberately not retained, so whether workers attempted an unavailable tool cannot be observed.
- The exact historical Pi executable version was not persisted.
- The retained state does not include an in-memory autonomous-state snapshot; the value two is inferred from unchanged source, fresh defaults, path fingerprinting, and exact observed scheduling.
- No provider/model rerun was performed during this investigation.

# Stock baseline orchestration anomaly investigation

**Date:** 2026-07-28  
**Baseline:** `npm:pi-messenger@0.14.1`, independent-parallel fixture  
**Status:** Investigation complete; no production fixes made

## Purpose

This report investigates four orchestration anomalies recorded in `evals/results/stock-pi-messenger-0.14.1-independent-parallel.md`:

1. work began despite `autoWork: false`;
2. successful worker commits were retried and ultimately marked blocked;
3. the profile declared concurrency three, while the run produced at most two overlapping workers; and
4. no task or integration reviews occurred.

The investigation uses the retained fixture state, task files, progress files, feed events, Git history, deterministic verifier output, the intended profile, and source paths matching stock tag `v0.14.1`. Raw worker/control transcripts and the effective runtime configuration were not retained, so this report distinguishes durable facts, operator attestations, and inference and does not infer private model reasoning.

## Executive conclusion

The investigation found two shared controller defects, one eval-configuration attestation gap, and one missing stock capability:

1. **The planning overlay bypasses the `autoWork` decision and the normal work controller.** It starts workers whenever planning changes from active to complete and refills slots on later renders. This strongly explains unauthorized work, retry ordering, and the absence of the normal work controller's automatic review hook.
2. **Worker launchers remove `pi_messenger` from the `--tools` allowlist.** Workers receive instructions requiring `task.done`, but the generated process arguments retain only built-in tool names. With the pinned current Pi tool-selection behavior, loading the extension does not restore an extension tool excluded by `--tools`. This strongly explains why workers could edit, test, and commit but did not perform the authoritative completion transition; the historical Pi executable version was not retained.
3. **The eval preparer writes the intended profile to a path the stock config loader does not read.** The run proves an effective attempt limit of two, but the source of that value and the rest of the effective configuration were not retained. The declared concurrency of three therefore cannot be treated as an attested runtime value. The overlay's hard-coded runtime default of two still matches the observed ceiling, but the claim that it overrode an effective value of three remains unproven.
4. **Stock v0.14.1 has no integration-review lifecycle.** It supports plan and task implementation review only. Integration review therefore could not occur even in a successful run.

These conclusions do not justify treating exit code zero or the presence of a commit as task completion. `task.done` remains the fail-closed authoritative transition.

## Baseline evidence classification

### Durable facts

- The checked profile declares `concurrency.workers: 3`, `concurrency.max: 3`, `review.enabled: true`, `review.maxIterations: 1`, and `work.maxAttemptsPerTask: 2`; its hash matches the result record.
- The generated plan and all three task records have no dependencies. The source files are disjoint.
- `plan.done` was recorded at `19:37:19.615Z`; tasks 1 and 2 started 18 ms and 26 ms later.
- The first attempts produced the three correct implementation commits before their worker processes exited.
- All six immutable functional checks passed, while every final task record was `blocked` with `attempt_count: 2` and `Max attempts (2) reached`.
- The feed contains no `task.done` or review event, and the plan remained at `completed_count: 0`.
- The maximum observed task-worker overlap was two. Task 3 first started 10 ms after task 2 blocked.
- The final task records prove that an attempt limit of two was effective, despite the stock default of five.

### Operator-attested facts

- The operator issued only the plan request with `autoWork: false` and did not issue `work`, retry, repair, or task-state commands.
- Raw control and worker transcripts were not retained, so the operator behavior cannot be reconstructed independently.

### Configuration attestation gap

- `evals/scripts/prepare-stock-runtime.mjs` wrote the intended Crew profile to `$PI_CODING_AGENT_DIR/pi-messenger.json`.
- Stock `crew/utils/config.ts` reads user Crew configuration from hard-coded `~/.pi/agent/pi-messenger.json` plus worktree-local `.pi/messenger/crew/config.json`.
- The worktree has no project Crew config, the isolated runtime was securely deleted, and the historical home-directory config was not retained.
- Consequently, the effective concurrency, models, review iteration limit, and source of the effective attempt limit are unknown. The profile is an intended configuration record, not proof that every value loaded.

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

The 18–26 ms start timing, overlay progress-message fingerprint, and two-worker signature match this path. An explicit `work` call would have synchronized autonomous state from the effective Crew configuration before spawning; the overlay did not. Because the effective historical configuration is not attested, this does not prove that the synchronized value would have been three.

### Rejected or bounded alternatives

- **Dropped/coerced parameter:** rejected by unchanged parameter forwarding and handler tests.
- **Normal pending-auto-work hook:** rejected because explicit false does not set the pending flag; that hook sends a steer rather than directly spawning workers.
- **Control model issued `work`:** not forensically excludable without the raw transcript. The operator attests that no work command was requested; the immediate direct-worker event path and progress-message fingerprint support overlay dispatch.
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
- At the effective limit, it marks the task blocked.
- Process exit code zero does not override the missing task transition.

Therefore the state outcome is deterministic once `task.done` is absent. Treating a clean process exit or any Git commit as completion would be unsafe because neither proves that the assigned acceptance criteria were met.

## Finding 4: the overlay used runtime concurrency two; effective profile loading is unknown

**Confidence:** High for the executed two-slot path; low for the claim that an effective value of three was overridden

The normal work controller loads `config.concurrency.workers` and writes it to autonomous runtime state before calling `spawnAgents` (`crew/handlers/work.ts:100-110`). The overlay bypasses that controller and instead reads the initial `autonomousState.concurrency`, which is hard-coded to two (`crew/state-autonomous.ts:31-40`). The observed initial two-worker wave matches that path.

The checked profile declares three workers, but the eval preparer/config-loader path mismatch means the effective historical value is unproven. Two distinct causes therefore remain:

1. the overlay bypassed an effective configured value of three; or
2. the intended profile was not loaded and the effective configuration was already two.

Both expose deterministic reliability problems: the overlay uses unrelated runtime state instead of the authoritative work lifecycle, and the eval harness did not retain proof of its effective configuration. Only the first explains the product concurrency anomaly as originally worded, so that attribution remains open.

Task ordering still explains why task 3 waited once execution had two slots:

- ready tasks are returned in numeric task order;
- `crew/spawn.ts:25-85` repeatedly selects the first currently ready task;
- exited attempts for tasks 1 and 2 became `todo` again;
- refill selected those lower-numbered retries before untouched task 3;
- task 3 started immediately after task 2 finally blocked and released a slot.

Dependencies, file reservations, workload shape, and provider capacity do not explain the two emitted initial starts: all tasks were independent, reservations are not a scheduler gate, and only two `task.start` events were emitted before any provider-side capacity could matter. They also do not establish what concurrency value the normal configured path would have used.

## Finding 5: review absence was overdetermined

**Confidence:** High

### Task review

Automatic task review exists only inside `crew/handlers/work.ts:225-264`, after the normal controller awaits worker results and classifies tasks into `succeeded`.

The overlay/direct spawn path does not call this review hook. Therefore even an overlay-spawned worker that successfully reached `done` could escape automatic review.

In this run, missing completion was independently sufficient to prevent review: every task remained non-successful and ultimately blocked. No reviewer-dispatch or skipped-review event appears in retained progress/feed evidence.

### Integration review

Stock v0.14.1 exposes only plan and implementation review. `crew/handlers/review.ts` contains no integration-review action, state, prompt, or terminal lifecycle dispatch. Integration review was therefore unavailable, not merely skipped because the run ended blocked.

## Candidate deterministic regressions by scope

These tests follow from the investigation, but their rollout phase must be approved rather than inferred from the baseline:

### Eval-harness correction before another comparative run

1. **Effective configuration attestation**
   - Launch the isolated stock runtime through the production config loader.
   - Assert and record the effective concurrency, models, review settings, attempt limit, and config source before provider usage.
   - Fail preparation on any mismatch with the checked profile.

### Proposed Phase 1 reliability scope expansion

These are not explicit Phase 1 rollout items in `PRD.md`; include them only if the Phase 1 design approves the expansion:

2. **Plan authorization matrix**
   - Simulate planning active → complete with an open overlay.
   - With `autoWork: false`, assert no worker spawn, no `task.start`, and all tasks remain `todo`.
   - With `autoWork: true`, assert exactly one authorized dispatch path.

3. **Effective initial concurrency**
   - Configure workers/max to three with three independent ready tasks.
   - Assert the authorized work lifecycle observes and dispatches the effective configured value.

4. **Worker tool capability**
   - For ordinary and lobby worker launchers, inspect generated process arguments.
   - Assert the required `pi_messenger` extension tool remains available alongside selected built-ins.

5. **Exit-zero lifecycle**
   - Exit zero while still `in_progress` must not be classified as success.
   - Attempt one may reset according to policy; the maximum attempt must stop deterministically.
   - Persisting `task.done` before close must preserve `done`.

Retry fairness remains an open product-policy question, not a deterministic assertion, until the design decides whether untouched ready work should precede retries.

### Phase 2 review scope

6. **Task-review dispatch**
   - A task completed through every supported execution path must receive exactly one enabled task review before terminal acceptance.

7. **Integration-review lifecycle**
   - Once all task-scoped reviews pass, require exactly one explicit integration review before the plan is declared complete when configured.

## Rollout implications

The authoritative Phase 1 scope remains the reliability and observability work listed in `PRD.md`. Plan authorization, worker tool capability, exit lifecycle, and effective concurrency are evidence-backed proposed additions that require explicit approval in the Phase 1 design. Task and integration review belong to Phase 2. Retry fairness requires a product decision before test design.

Production fixes are intentionally not selected in this report. The central architectural question is whether the overlay may execute work directly or must remain a display/control surface that delegates to one authoritative work lifecycle. A separate immediate eval-harness requirement is to prove and retain effective configuration before any future comparative run.

## Residual unknowns

- Raw worker/control transcripts were deliberately not retained, so whether workers attempted an unavailable tool cannot be observed.
- The exact historical Pi executable version was not persisted.
- The retained state does not include an in-memory autonomous-state snapshot; the executed two-slot path is inferred from unchanged source, fresh defaults, path fingerprinting, and exact observed scheduling.
- The effective historical Crew configuration, its source, and the worker model remain unknown; the intended profile is not runtime attestation.
- Operator behavior is attested rather than independently reconstructable.
- No provider/model rerun was performed during this investigation.

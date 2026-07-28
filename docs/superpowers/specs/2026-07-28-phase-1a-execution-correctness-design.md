# Phase 1A Execution Correctness Design

**Date:** 2026-07-28
**Status:** Approved design awaiting written-spec review

## Context, scope, and non-goals

The independent-parallel baseline has several launch paths, and a launcher can omit the required `pi_messenger` extension tool. Phase 1A establishes one deterministic controller, durable completion/review lifecycle, and correct process accounting before Phase 1B adds reliability and observability.

Phase 1A does **not** add provider/model evaluation, artifact storage, pause recovery, file watching, saved-session resume, or Phase 2 review packages/scope semantics. Legacy review remains a compatibility adapter, not a redesign.

## Controller, identity, and durable scheduler state

A plan has an immutable UUID `run_id`. A legacy plan without one is migrated by generating and atomically persisting it before a lease or scheduler action. This additive migration does not make an old binary safe to operate once it encounters new lifecycle states.

Exactly one controller owns a normalized repository path and `run_id`. Its exclusive lease contains `{ version, controllerId, leaseEpoch, pid, planRunId, normalizedRepoPath, acquiredAt }`. A live compatible owner makes all contenders read-only. A stale lease is reclaimed only after liveness and plan identity checks under the same exclusive acquisition protocol. Replan, deletion, lease loss, or a changed `run_id` invalidates authorization.

The controller persists a versioned scheduler record before every launch or stop/cancellation action:

```text
{
  version, runId, controllerId, leaseEpoch,
  mode, waveSnapshotTaskIds, waveTargetState,
  desiredConcurrencyOverride, activeAttemptIds,
  cancellationIntent, interruptedAt?
}
```

`mode` is `idle | wave | continuous | targeted | paused`; `waveTargetState` records outstanding snapshot IDs and their authorization/retry eligibility, and `activeAttemptIds` identifies owned child attempts rather than trusting UI state. `cancellationIntent` records who requested cancellation, affected attempts, and whether it is a user stop or orchestrator shutdown. The record is atomically updated before spawning, signaling, or changing ownership.

On controller restart or stale-lease takeover, the new controller fails closed: it records an interrupted/paused-for-manual-reauthorization state, launches nothing, and does not auto-resume a prior wave, continuous run, target, or retry. It retains recorded live child PIDs and attempt IDs until each is proven dead, reconciles durable task and legacy-review outcomes, and counts surviving children against slots. It does not adopt a survivor for new control. Only an explicit valid `work`/start command establishes new launch authorization.

## Authorization and scheduling

There is one in-process, event-driven scheduler. Only it selects work and invokes the shared launcher. `work` and overlay controls are adapters; the overlay may render and issue explicit commands but may not call worker/lobby spawn APIs. Reconciliation requests coalesce into one pending subsequent pass and never require a model turn.

| Mode | Entry and permission | Clear/invalidation |
|---|---|---|
| `idle` | Initial/completed-drain state; no dispatch | A new explicit authorization is required |
| `wave` | `work` with omitted/false `autonomous`; snapshot IDs dependency-ready at authorization, including their existing bounded retries and review lifecycle | Clear only when every snapshot ID is terminal or deterministically unavailable and no snapshot attempt/review is outstanding; pause, replan, deletion, lease loss invalidate |
| `continuous` | `autoWork: true` after planning or `work { autonomous: true }`; fills slots and includes newly-ready work | Pause, plan terminal, replan, deletion, lease loss, or shutdown |
| `targeted` | Explicit task start; one selected ID receives one launch attempt | Consumed after launch/refusal; otherwise invalidated as above |
| `paused` | Explicit pause, interruption pending manual reauthorization, or Phase 1B embargo | No dispatch until an explicit valid command establishes a new applicable mode |

A wave never admits a newly-ready ID, while continuous mode does. A user stop invalidates unconsumed authorization. A wave's `review_pending` or `claiming` snapshot task is outstanding: it is neither terminal nor non-launchable for drain purposes, and authorization remains valid until its review outcome. A `NEEDS_WORK` result remains in the snapshot and may retry only under that still-active authorization and bounded retry policy.

A pass verifies lease/run identity and dispatchable authorization, reconciles child and review ownership, loads configuration, computes slots, selects eligible IDs, then dispatches. Active slots count verified live assigned task workers; warm idle lobby workers do not consume active task slots, though the warm pool cannot exceed desired concurrency. Lowering concurrency never kills an assigned worker and retires only excess idle lobby workers. Selection uses existing stable ordering, with `attempt_count === 0` before retries. Dependencies, reservation, attempt limits, pause, and authorization all still apply.

Ordinary and lobby launchers share one Pi argument/tool contract that preserves declared built-ins and required named extension tools, including `pi_messenger`. Loading an extension alone is not tool selection, and the fix must not remove all restrictions.

## Durable task completion and legacy review lifecycle

Task status includes `todo`, active/assigned states, `done`, `blocked`, and new `review_pending`; Phase 1B may add `paused`. A task also has an optional additive, versioned `legacy_review_state`:

```text
{
  version: 1,
  state: "pending" | "claiming" | "ship" | "needs_work" | "major_rethink" | "failed",
  claimToken?: UUID,
  claimantControllerId?: string,
  claimedAt?: timestamp,
  completedAt?: timestamp,
  reviewCount: number,
  outcome?: "SHIP" | "NEEDS_WORK" | "MAJOR_RETHINK",
  failureCode?: string,
  attemptId: UUID
}
```

When review is enabled, `task.done` atomically writes worker evidence for the currently owned `attempt_id` and sets task status to `review_pending` with `legacy_review_state.state = pending` and the same `attemptId`. Without review, it atomically writes the same attempt-scoped evidence and sets `done`. `task.done` is a compare-and-set against the task's current owned attempt: the first matching call commits; a same-attempt duplicate is an idempotent no-op returning the committed state; a stale, foreign, or no-longer-owned attempt is rejected and cannot alter task/review state. `done` is the only state that unlocks dependents; `review_pending` and `claiming` never do. Old task JSON migrates additively by adding absent fields when read/written. Once these statuses are present, an updated binary is required to operate on the plan; an old binary must not control it.

Under the active controller lease and dispatch authorization, the scheduler atomically claims `pending -> claiming` with a new token/controller/timestamp and the matching `attemptId`, then invokes the existing reviewer. The external reviewer invocation is **at least once** across a crash boundary: a crash after invocation but before commit can cause another invocation. The design makes only the durable outcome commit once; it does not claim exactly-once model invocation. Once claimed, a live claimant may commit using active lease, run ID, claim token, and attempt ID even if a later pause/stop invalidates dispatch authorization; authorization controls starting provider work, not committing an already-started review. Lease/token/attempt mismatch rejects the commit. The committing controller then atomically commits exactly one outcome:

| Reviewer outcome | Atomic durable result |
|---|---|
| `SHIP` | review state `ship`; task `done` |
| `NEEDS_WORK` | review state `needs_work`; task `todo` under the existing bounded retry policy and active wave/continuous authorization |
| `MAJOR_RETHINK` | review state `major_rethink`; task `blocked` with actionable reason |
| unavailable, malformed, or failure | review state `failed`; task `blocked` with actionable reason |

A stale `claiming` review reverts to `pending` only after its claimant controller/process is proven dead. Startup scans both `review_pending` and `claiming` states before any new launch. Fail-closed restart/pause does not start a pending review; explicit work reauthorization resumes pending reviews before dispatching retries/dependents. A live already-claimed review may finish and commit while dispatch remains paused. A late process close, duplicate review completion, or outcome for a different attempt cannot overwrite an already committed state.

A wave's pending/claimed review remains outstanding until this attempt-scoped outcome commits. `NEEDS_WORK` archives/clears the prior completion claim into bounded task progress/history, returns the task to `todo`, and requires a new `attempt_id`; the old attempt's close or late `task.done` cannot satisfy or overwrite the new attempt.

## Attempts, cancellation, and exit precedence

Every dispatch has a durable UUID `attempt_id` and records process identity plus `attemptCharged`, `rollbackApplied`, and cancellation fields. Dispatch-time accounting is charged once; cancellation rollback is atomically guarded by `rollbackApplied`, so it occurs at most once even across restart/reconciliation.

For a child close, classification order is strict:

1. durable `task.done` and durable legacy-review state;
2. persisted cancellation intent for that `attempt_id`; then
3. observed exit code/signal.

Thus a durable completion/review record wins over a close fact only when its `attemptId` matches the closing attempt. A persisted cancellation classifies as cancellation even if the process exits nonzero or by signal. Cancellation clears ownership after close, restores `todo` with cancellation progress, and rolls back any charged attempt exactly once. User stop and orchestrator graceful shutdown use this identical behavior; neither is resumable unless Phase 1B explicitly requested resumable cancellation.

Absent durable completion or cancellation, close code `0` produces `blocked` with `blocked_code: protocol_incomplete`; nonzero, null/unknown, or signal produces `blocked` with `blocked_code: worker_crash`. Neither auto-retries in Phase 1A. `blocked_reason` remains the human fallback and no broader Phase 1A code enum is introduced.

## Events and deterministic tests

Every scheduler event has common payload `{ planRunId, controllerId, reasons }`, with applicable `taskId`, `attemptId`, and event-specific fields. Concurrent triggers are accumulated as a deduplicated set, emitted as canonical sorted `reasons`; no trigger is discarded. Command acknowledgement events (`scheduler.authorized` or `scheduler.paused`) are persisted first. Within the resulting reconciliation, reason processing order is `lease_or_run_invalidated`, `durable_completion`, `review_outcome`, `cancellation`, `child_close`, `explicit_action`, `configuration`, `dependency_mutation`, `overlay_refresh`; lexical sort applies within an equal class. Durable task/attempt outcome events are ordered by stable task ID and then attempt ID, review events follow their task outcome, dispatch events follow all outcomes that freed capacity, and `scheduler.idle` is last. This is one total ordering; the reconciliation priority never reorders the preceding command acknowledgement.

Events are `scheduler.authorized`, `scheduler.paused`, `scheduler.reconcile`, `task.dispatch`, `task.protocol_incomplete`, `task.worker_crash`, `task.cancelled`, `task.review_pending`, `task.review_claimed`, `task.review_completed`, `task.review_failed`, and `scheduler.idle`. Authorization/pause precedes reconciliation; reconciliation precedes dispatch/outcome events; `scheduler.idle` is last only after relevant authorization drains. Continuous mode is not cleared merely because it is temporarily waiting.

`awaitSchedulerIdle(cwd)` is a deterministic test hook: it waits for no queued/running reconciliation or pending pass, not elapsed time.

Focused fake-clock/no-sleep tests cover the authorization matrix; wave snapshots including pending/claiming review; continuous refill and targeted behavior; duplicate-reconciliation prevention; retry ordering and concurrency shrink; launcher tool arguments; every close-precedence row (including cancellation nonzero/signal); attempt-scoped `task.done` CAS, duplicate no-op, stale-attempt rejection, and exactly-once rollback across restart; review claim across pause, claimant death, manual reauthorization, each crash window, and each outcome; `NEEDS_WORK` new-attempt isolation; restart interruption/manual reauthorization and survivor slot accounting; lease/replan reconciliation; canonical reason-set events/total ordering; and idle drain behavior.

## Risks and rollout

Exclusive lease plus fail-closed restart prevents duplicate control. Durable task/review state, not process exit, remains authoritative. Legacy review is bounded compatibility only; Phase 2 owns review package/scope redesign. Implement serially: durable identity/record and pure scheduler tests; authorization/controller adapters; attempts/exits/review state machine; overlay/lobby tool contract; deterministic regression and review.

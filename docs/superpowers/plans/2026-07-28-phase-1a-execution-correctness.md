# Phase 1A Execution Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every ad hoc Crew launch path with one leased, durable, event-driven controller that enforces authorization, attempt-scoped completion, deterministic review, cancellation, and process-exit semantics.

**Architecture:** Add a focused `crew/execution/` subsystem: versioned types and atomic persistence at the bottom, lease and event primitives above them, a pure selection/state-transition layer, and one controller that owns process and reviewer side effects. Existing `work`, task, planning, overlay, lobby, and shutdown paths become adapters into that controller; workers continue using `pi_messenger`, but `task.done` commits only against the trusted `PI_CREW_ATTEMPT_ID` assigned by the launcher.

**Tech Stack:** TypeScript 5.9 ESM, Node.js 24 filesystem/process APIs, Pi extension API/CLI, TypeBox, Vitest 4 fake timers and mocked child processes.

## Global Constraints

- A plan has an immutable UUID `run_id`; migrate a legacy plan by atomically persisting it before any lease or scheduler action.
- Exactly one compatible controller may own a normalized repository path and `run_id`; all contenders are read-only.
- Persist the scheduler record before every launch, signal, cancellation, or ownership change.
- Restart and stale-lease takeover fail closed in `paused` mode and never auto-resume old authorization, retries, or reviews.
- Only an explicit valid `work`/start command establishes launch authorization after interruption.
- The overlay may render and issue commands but may not call worker or lobby spawn APIs.
- A wave admits only its authorization-time dependency-ready snapshot; continuous mode may admit newly ready work.
- Preserve bounded retries, stable task ordering, dependency checks, reservations, pause state, and authorization checks.
- Active slots count verified live assigned task workers; idle lobby workers do not consume active task slots.
- Preserve declared built-in tools and required named extension tools, including `pi_messenger`; loading an extension is not tool selection, and the implementation must not remove all restrictions.
- `task.done` is an attempt-scoped compare-and-set: first matching completion commits, a duplicate is an idempotent no-op, and stale/foreign/unowned attempts are rejected.
- Only task status `done` unlocks dependencies; `review_pending` and `claiming` do not.
- External legacy-review invocation is at least once across crashes; durable review outcome commit is exactly once.
- Child close precedence is matching durable completion/review, then persisted cancellation intent, then exit code/signal.
- Cancellation rollback is guarded by durable `rollbackApplied` and occurs at most once across restart.
- Exit code `0` without protocol completion blocks with `blocked_code: protocol_incomplete`; nonzero, null/unknown, or signal blocks with `blocked_code: worker_crash`; neither auto-retries in Phase 1A.
- Event reasons are deduplicated and canonically sorted; event emission follows the total order in the approved design.
- Tests use fake clocks and explicit scheduler-idle waits, never sleeps.
- Do not add provider/model evaluation, artifact storage, pause recovery, file watching, saved-session resume, Phase 2 review packages, or Phase 2 review scope semantics.

---

### Task 1: Add versioned execution records, migration, and exclusive leases

**Files:**

- Create: `crew/execution/types.ts`
- Create: `crew/execution/store.ts`
- Create: `crew/execution/lease.ts`
- Modify: `crew/types.ts:15-56`
- Modify: `crew/store.ts:43-57,79-118,209-234`
- Test: `tests/crew/execution-store.test.ts`
- Test: `tests/crew/execution-lease.test.ts`
- Reference: `docs/superpowers/specs/2026-07-28-phase-1a-execution-correctness-design.md`

**Interfaces:**

- Consumes: Existing `.pi/messenger/crew/plan.json` and task JSON files.
- Produces: `ensurePlanRunId(cwd): Plan`, `readSchedulerRecord(cwd): SchedulerRecord | null`, `writeSchedulerRecord(cwd, record): void`, `createAttempt(cwd, attempt): void`, `readAttempt(cwd, attemptId): AttemptRecord | null`, `updateAttempt(cwd, attemptId, mutate): AttemptRecord`, `acquireControllerLease(cwd, runId, controllerId): LeaseAcquisition`, `validateControllerLease(cwd, lease): boolean`, and `releaseControllerLease(cwd, lease): void`.

- [ ] **Step 1: Write failing migration and persistence tests**

Create `tests/crew/execution-store.test.ts` with deterministic UUID/time injection and these cases:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as crewStore from "../../crew/store.js";
import {
  createAttempt, ensurePlanRunId, readAttempt, readSchedulerRecord,
  updateAttempt, writeSchedulerRecord,
} from "../../crew/execution/store.js";
import type { AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";

function idleRecord(controllerId = "controller-a"): SchedulerRecord {
  return {
    version: 1, runId, controllerId, leaseEpoch: 1, mode: "idle",
    waveSnapshotTaskIds: [], waveTargetState: {}, desiredConcurrencyOverride: null,
    activeAttemptIds: [], cancellationIntent: null,
  };
}

describe("execution persistence", () => {
  it("atomically adds one immutable run_id to a legacy plan", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const migrated = ensurePlanRunId(cwd, { uuid: () => runId, now: () => now });
    expect(migrated.run_id).toBe(runId);
    expect(ensurePlanRunId(cwd, { uuid: () => "22222222-2222-4222-8222-222222222222", now: () => now }).run_id).toBe(runId);
    expect(JSON.parse(readFileSync(join(crewDir, "plan.json"), "utf8")).run_id).toBe(runId);
  });

  it("round-trips the complete scheduler record", () => {
    const { cwd } = createTempCrewDirs();
    writeSchedulerRecord(cwd, idleRecord());
    expect(readSchedulerRecord(cwd)).toEqual(idleRecord());
  });

  it("guards attempt charging and rollback across reload", () => {
    const { cwd } = createTempCrewDirs();
    const attempt: AttemptRecord = {
      version: 1, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId,
      taskId: "task-1", controllerId: "controller-a", leaseEpoch: 1,
      workerName: "worker-a", pid: 42, startedAt: now, state: "running",
      attemptCharged: true, rollbackApplied: false, cancellation: null,
    };
    createAttempt(cwd, attempt);
    updateAttempt(cwd, attempt.attemptId, current => ({ ...current, rollbackApplied: true }));
    expect(readAttempt(cwd, attempt.attemptId)?.rollbackApplied).toBe(true);
  });

  it("normalizes absent additive task fields without changing old status", () => {
    const { cwd, tasksDir } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Legacy");
    const path = join(tasksDir, `${task.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.current_attempt_id;
    delete raw.legacy_review_state;
    writeFileSync(path, JSON.stringify(raw));
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
  });
});
```

- [ ] **Step 2: Run the store test and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-store.test.ts
```

Expected: FAIL because `crew/execution/store.ts` does not exist and `Plan.run_id` is undefined.

- [ ] **Step 3: Define the durable execution types**

Create `crew/execution/types.ts` with these public contracts:

```typescript
export type ExecutionMode = "idle" | "wave" | "continuous" | "targeted" | "paused";
export type ReviewState = "pending" | "claiming" | "ship" | "needs_work" | "major_rethink" | "failed";
export type ReviewOutcome = "SHIP" | "NEEDS_WORK" | "MAJOR_RETHINK";
export type CancellationKind = "user_stop" | "orchestrator_shutdown";
export type AttemptState = "starting" | "running" | "closed";

export interface WaveTargetEntry {
  authorized: boolean;
  retryEligible: boolean;
  terminal: boolean;
  unavailableReason?: string;
}

export interface CancellationIntent {
  requestedBy: string;
  kind: CancellationKind;
  attemptIds: string[];
  requestedAt: string;
}

export interface SchedulerRecord {
  version: 1;
  runId: string;
  controllerId: string;
  leaseEpoch: number;
  mode: ExecutionMode;
  waveSnapshotTaskIds: string[];
  waveTargetState: Record<string, WaveTargetEntry>;
  desiredConcurrencyOverride: number | null;
  activeAttemptIds: string[];
  cancellationIntent: CancellationIntent | null;
  interruptedAt?: string;
}

export interface ControllerLease {
  version: 1;
  controllerId: string;
  leaseEpoch: number;
  pid: number;
  planRunId: string;
  normalizedRepoPath: string;
  acquiredAt: string;
}

export interface AttemptCancellation {
  kind: CancellationKind;
  requestedBy: string;
  requestedAt: string;
}

export interface AttemptRecord {
  version: 1;
  attemptId: string;
  runId: string;
  taskId: string;
  controllerId: string;
  leaseEpoch: number;
  workerName: string;
  pid: number | null;
  startedAt: string;
  closedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  state: AttemptState;
  attemptCharged: boolean;
  rollbackApplied: boolean;
  cancellation: AttemptCancellation | null;
}

export interface LegacyReviewState {
  version: 1;
  state: ReviewState;
  claimToken?: string;
  claimantControllerId?: string;
  claimedAt?: string;
  completedAt?: string;
  reviewCount: number;
  outcome?: ReviewOutcome;
  failureCode?: string;
  attemptId: string;
}
```

Modify `crew/types.ts` so `Plan` gains `run_id?: string`, `TaskStatus` includes `review_pending`, and `Task` gains `current_attempt_id?: string`, `completion_attempt_id?: string`, `legacy_review_state?: LegacyReviewState`, and `blocked_code?: "protocol_incomplete" | "worker_crash"`. Import `LegacyReviewState` with `import type`. `completion_attempt_id` is the durable idempotency key for review-disabled completion; review-enabled completion uses the matching `legacy_review_state.attemptId`.

- [ ] **Step 4: Implement atomic execution persistence and additive migration**

Create `crew/execution/store.ts`. Use sibling temporary files plus `renameSync`, validate `version === 1` and matching IDs on read, and expose these exact paths:

```typescript
schedulerPath(cwd)             // .pi/messenger/crew/scheduler.json
attemptPath(cwd, attemptId)    // .pi/messenger/crew/attempts/<attemptId>.json
leaseDirectory(cwd)            // .pi/messenger/crew/controller-lease
```

Implement `ensurePlanRunId()` by reading the plan, returning it unchanged when `run_id` exists, otherwise assigning `deps.uuid()`, updating `updated_at` with `deps.now()`, and atomically replacing `plan.json`. Implement `updateAttempt()` as synchronous read-modify-atomic-write and reject an `attemptId` change from the mutator. Export a reusable `atomicWriteJson(path, value)` so lease and event code use the same durability primitive.

Update `crew/store.ts` to call the shared atomic writer, preserve optional execution fields in `normalizeTask`, and ensure `createPlan()` leaves `run_id` absent until `ensurePlanRunId()` performs the required pre-controller migration.

- [ ] **Step 5: Run the store test and verify GREEN**

Run:

```bash
npx vitest run tests/crew/execution-store.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Write failing exclusive-lease tests**

Create `tests/crew/execution-lease.test.ts` using injected `{ pid, now, isProcessAlive }`. Cover:

```typescript
it("grants one owner and makes a live compatible contender read-only", () => {
  const first = acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
  const second = acquireControllerLease(cwd, runId, "controller-b", liveDeps(202, new Set([101])));
  expect(first).toMatchObject({ acquired: true, lease: { leaseEpoch: 1 } });
  expect(second).toMatchObject({ acquired: false, reason: "live_owner" });
});

it("reclaims a dead compatible owner with a higher epoch", () => {
  acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
  const takeover = acquireControllerLease(cwd, runId, "controller-b", liveDeps(202, new Set()));
  expect(takeover).toMatchObject({ acquired: true, reclaimed: true, lease: { leaseEpoch: 2 } });
});

it("replaces an incompatible prior-run lease only after confirming the current plan identity", () => {
  seedPlan({ run_id: otherRunId });
  seedLease({ planRunId: runId, normalizedRepoPath: normalizedCwd, pid: 101 });
  const nextRun = acquireControllerLease(cwd, otherRunId, "controller-b", liveDeps(202, new Set([101])));
  expect(nextRun).toMatchObject({ acquired: true, reclaimed: true, lease: { planRunId: otherRunId, leaseEpoch: 2 } });
});

it("refuses an unexpected repository identity in the repository-local lease", () => {
  seedLease({ planRunId: runId, normalizedRepoPath: "/other/repo", pid: 101 });
  expect(acquireControllerLease(cwd, runId, "controller-b", deadDeps(202))).toMatchObject({
    acquired: false, reason: "repository_identity_mismatch",
  });
});
```

Also test that `releaseControllerLease()` cannot remove a different controller/epoch and that `validateControllerLease()` fails after plan deletion or `run_id` replacement.

- [ ] **Step 7: Run the lease test and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-lease.test.ts
```

Expected: FAIL because `crew/execution/lease.ts` does not exist.

- [ ] **Step 8: Implement exclusive acquisition, stale takeover, and identity validation**

Create `crew/execution/lease.ts`. Acquire with `mkdirSync(controller-lease)` as the exclusive operation. Store `lease.json` and `epoch.json` inside; on a dead owner, atomically rename the whole directory to `controller-lease.stale-<controllerId>-<epoch>`, create a fresh directory, persist epoch `old + 1`, then remove the tombstone. If another contender wins either rename or mkdir, reread and return read-only rather than retrying side effects.

Normalize repositories with `realpathSync(cwd)` plus `normalize()`; validate `controllerId`, `leaseEpoch`, `planRunId`, normalized path, live PID, and current plan `run_id` on every authorization check. A live matching repository/run owner makes contenders read-only. When the current atomically read plan has a different `run_id`, the old lease is incompatible and cannot authorize anything; replace it under the same rename/mkdir protocol even if its PID is still live. Refuse a repository-path mismatch because it indicates corrupt or misplaced lease state. Return a discriminated result:

```typescript
export type LeaseAcquisition =
  | { acquired: true; reclaimed: boolean; lease: ControllerLease }
  | { acquired: false; reason: "live_owner" | "plan_identity_mismatch" | "repository_identity_mismatch" | "race_lost"; lease?: ControllerLease };
```

- [ ] **Step 9: Run focused tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-store.test.ts tests/crew/execution-lease.test.ts tests/crew/store.test.ts
```

Expected: all focused tests pass.

```bash
git add -- crew/execution/types.ts crew/execution/store.ts crew/execution/lease.ts crew/types.ts crew/store.ts tests/crew/execution-store.test.ts tests/crew/execution-lease.test.ts
git diff --cached --check
git commit -m "feat: add durable execution identity and lease"
```

---

### Task 2: Build the deterministic authorization and reconciliation core

**Files:**

- Create: `crew/execution/events.ts`
- Create: `crew/execution/selection.ts`
- Create: `crew/execution/scheduler.ts`
- Test: `tests/crew/execution-selection.test.ts`
- Test: `tests/crew/execution-scheduler.test.ts`

**Interfaces:**

- Consumes: Task snapshots, `SchedulerRecord`, lease validation, and atomic scheduler persistence from Task 1.
- Produces: `selectDispatches(input): SelectionResult`, `createScheduler(deps): ExecutionScheduler`, `authorize(command): Promise<CommandAck>`, `requestReconcile(reason, facts?): void`, `pause(requestedBy): Promise<CommandAck>`, `stop(requestedBy, kind): Promise<CommandAck>`, `awaitIdle(): Promise<void>`, and canonical persisted scheduler events.

- [ ] **Step 1: Write the pure selection matrix test**

Create `tests/crew/execution-selection.test.ts` with table-driven cases for all modes. Use task IDs whose lexical ordering differs from retry priority:

```typescript
const tasks = [
  task("task-2", "todo", 1),
  task("task-1", "todo", 0),
  task("task-3", "todo", 0, ["task-1"]),
];

it.each([
  ["idle", record("idle"), [], []],
  ["paused", record("paused"), [], []],
  ["wave excludes newly ready IDs", waveRecord(["task-1", "task-2"]), tasks, ["task-1", "task-2"]],
  ["continuous uses current readiness", record("continuous"), tasks, ["task-1", "task-2"]],
  ["targeted consumes exactly one ID", targetedRecord("task-2"), tasks, ["task-2"]],
])("%s", (_name, scheduler, inputTasks, expected) => {
  expect(selectDispatches(baseInput({ scheduler, tasks: inputTasks })).taskIds).toEqual(expected);
});
```

Add explicit assertions that attempt-zero tasks precede retries, task ID is the stable tie-breaker, `review_pending`/`claiming` remain wave-outstanding, max attempts and reservations are unavailable, strict dependencies require `done`, advisory dependencies do not, live assigned attempts consume slots, idle lobby workers do not, and reduced concurrency does not select more work or kill assigned workers.

- [ ] **Step 2: Run the selection test and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-selection.test.ts
```

Expected: FAIL because `crew/execution/selection.ts` does not exist.

- [ ] **Step 3: Implement the side-effect-free selector**

Create `crew/execution/selection.ts` with this input boundary:

```typescript
export interface SelectionInput {
  scheduler: SchedulerRecord;
  tasks: Task[];
  liveAssignedAttemptIds: Set<string>;
  reservedTaskIds: Set<string>;
  desiredConcurrency: number;
  maxAttemptsPerTask: number;
  dependencies: "advisory" | "strict";
}

export interface SelectionResult {
  taskIds: string[];
  unavailable: Record<string, string>;
  waveDrained: boolean;
  planTerminal: boolean;
  slots: number;
}
```

Filter by mode authorization before readiness. Sort eligible tasks by `[attempt_count === 0 ? 0 : 1, task.id]`. For wave drain, treat `review_pending` and review state `claiming` as outstanding; drain only after every snapshot ID is terminal (`done`/`blocked`) or has a deterministic unavailable reason and no matching active attempt/review.

- [ ] **Step 4: Run the selection test and verify GREEN**

Run:

```bash
npx vitest run tests/crew/execution-selection.test.ts
```

Expected: all selection cases pass.

- [ ] **Step 5: Write failing coalescing, event-ordering, and acknowledgement tests**

Create `tests/crew/execution-scheduler.test.ts` around injected fake persistence, launcher, reviewer, task repository, and event sink. Verify:

```typescript
it("coalesces concurrent triggers into one pending pass without dropping reasons", async () => {
  const scheduler = createHarness().scheduler;
  scheduler.requestReconcile("overlay_refresh");
  scheduler.requestReconcile("configuration");
  scheduler.requestReconcile("overlay_refresh");
  await scheduler.awaitIdle();
  expect(events.named("scheduler.reconcile")[0].reasons).toEqual(["configuration", "overlay_refresh"]);
  expect(harness.reconcileCalls).toBe(1);
});

it("persists authorization acknowledgement before reconciliation and dispatch", async () => {
  await scheduler.authorize({ kind: "wave", requestedBy: "human", concurrency: 2 });
  await scheduler.awaitIdle();
  expect(events.names()).toEqual(["scheduler.authorized", "scheduler.reconcile", "task.dispatch", "task.dispatch"]);
  expect(persistedBefore("scheduler.authorized")).toBe(true);
});
```

Use `it.each` for reason classes in this exact order: `lease_or_run_invalidated`, `durable_completion`, `review_outcome`, `cancellation`, `child_close`, `explicit_action`, `configuration`, `dependency_mutation`, `overlay_refresh`. Add event-order cases asserting task outcome order by task ID then attempt ID, review after its task outcome, dispatch after outcomes free slots, and `scheduler.idle` last. Assert continuous mode emits no idle event merely because it is temporarily waiting.

- [ ] **Step 6: Run scheduler tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-scheduler.test.ts
```

Expected: FAIL because scheduler/events modules do not exist.

- [ ] **Step 7: Implement canonical events and a single-flight scheduler loop**

Create `crew/execution/events.ts` with the exact event union:

```typescript
export type SchedulerEventName =
  | "scheduler.authorized" | "scheduler.paused" | "scheduler.reconcile"
  | "task.dispatch" | "task.protocol_incomplete" | "task.worker_crash"
  | "task.cancelled" | "task.review_pending" | "task.review_claimed"
  | "task.review_completed" | "task.review_failed" | "scheduler.idle";

export interface SchedulerEvent {
  version: 1;
  name: SchedulerEventName;
  at: string;
  planRunId: string;
  controllerId: string;
  reasons: string[];
  taskId?: string;
  attemptId?: string;
  fields?: Record<string, unknown>;
}
```

Append events to `.pi/messenger/crew/scheduler-events.jsonl` only after the corresponding durable record commit. Canonicalize reason sets with `Array.from(set).sort()` for payload display, but process classes using the design’s priority map.

Create `crew/execution/scheduler.ts` with `running`, `pending`, `pendingReasons`, and waiter arrays. `requestReconcile()` merges reasons; if a pass is running it sets `pending = true`, otherwise it queues one microtask. A finished pass immediately runs one merged subsequent pass. `awaitIdle()` resolves only when no queued/running/pending pass remains. `authorize()` atomically persists the mode and wave/target snapshot, persists/emits `scheduler.authorized`, then requests `explicit_action`; `pause()` does the equivalent with `scheduler.paused`. Every pass starts by validating lease/run identity and returns without provider/process side effects when invalid.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-selection.test.ts tests/crew/execution-scheduler.test.ts
```

Expected: all tests pass with no real processes or timers.

```bash
git add -- crew/execution/events.ts crew/execution/selection.ts crew/execution/scheduler.ts tests/crew/execution-selection.test.ts tests/crew/execution-scheduler.test.ts
git diff --cached --check
git commit -m "feat: add deterministic execution scheduler"
```

---

### Task 3: Unify launch arguments and make attempts, cancellation, and close precedence durable

**Files:**

- Create: `crew/execution/tool-contract.ts`
- Create: `crew/execution/launcher.ts`
- Create: `crew/execution/attempts.ts`
- Modify: `crew/agents.ts:41-46,128-169,171-417`
- Modify: `crew/lobby.ts:54-212,222-365`
- Modify: `crew/registry.ts:11-114`
- Modify: `crew/spawn.ts:20-106`
- Test: `tests/crew/execution-launcher.test.ts`
- Test: `tests/crew/execution-attempts.test.ts`
- Modify test: `tests/crew/lobby.test.ts`
- Modify test: `tests/crew/graceful-shutdown.test.ts`

**Interfaces:**

- Consumes: Scheduler dispatch decisions and durable attempt store.
- Produces: `buildPiToolArgs(agentConfig, extensionDir): string[]`, `launchAttempt(request): LaunchedAttempt`, `persistCancellation(request): void`, `signalCancelledAttempts(request): void`, and `classifyChildClose(input): CloseClassification`.

- [ ] **Step 1: Write the failing shared tool-contract test**

Create `tests/crew/execution-launcher.test.ts` and capture `spawn("pi", args, options)` for ordinary and lobby launches:

```typescript
it.each(["ordinary", "lobby"])("preserves built-ins and selects pi_messenger for %s workers", async kind => {
  await launch(kind, { tools: ["read", "write", "edit", "bash", "pi_messenger"] });
  const args = spawnArgs();
  expect(option(args, "--tools").split(",")).toEqual(["read", "write", "edit", "bash", "pi_messenger"]);
  expect(args).toContain("--extension");
  expect(args).toContain(EXTENSION_DIR);
});

it("keeps named non-built-in extension tools in --tools and path extensions in --extension", () => {
  expect(buildPiToolArgs(agent({ tools: ["read", "pi_messenger", "/tmp/custom.ts"] }), EXTENSION_DIR)).toEqual([
    "--tools", "read,pi_messenger", "--extension", "/tmp/custom.ts", "--extension", EXTENSION_DIR,
  ]);
});
```

Also assert restrictions remain present when the agent declares tools, no empty `--tools` is emitted, and ordinary/lobby paths use the same helper.

- [ ] **Step 2: Run launcher tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-launcher.test.ts
```

Expected: FAIL because named `pi_messenger` is currently dropped and the shared helper does not exist.

- [ ] **Step 3: Implement the shared Pi argument contract and durable launcher boundary**

Create `crew/execution/tool-contract.ts`. Classify only path-like entries as `--extension`; pass every declared named tool, including extension-provided names, through `--tools`. Always load `EXTENSION_DIR`, but do not infer that loading selects `pi_messenger`.

Create `crew/execution/launcher.ts` with:

```typescript
export interface LaunchAttemptRequest {
  cwd: string;
  runId: string;
  controllerId: string;
  leaseEpoch: number;
  task: Task;
  attemptId: string;
  workerName: string;
  prompt: string;
  modelOverride?: string;
  lobbyWorker?: LobbyWorkerEntry;
}

export interface LaunchedAttempt {
  attempt: AttemptRecord;
  proc: ChildProcess;
}
```

Before spawning or writing a lobby assignment message: atomically set the task to `in_progress`, assign `current_attempt_id`, increment `attempt_count`, create an attempt with `attemptCharged: true`, and add its ID to scheduler `activeAttemptIds`. Spawn with `PI_CREW_ATTEMPT_ID`, `PI_CREW_RUN_ID`, and `PI_CREW_CONTROLLER_ID`. After spawn, atomically attach the PID. If spawn/assignment fails before a child owns work, route the failure through the same guarded rollback function rather than decrementing inline.

Refactor `crew/agents.ts`, `crew/lobby.ts`, and `crew/spawn.ts` so scheduler-owned task launch uses this boundary. Keep generic planner/reviewer `spawnAgents()` available for non-task provider work, but make task-bearing `spawnAgents()` inaccessible to adapters after Task 5.

- [ ] **Step 4: Run launcher tests and verify GREEN**

Run:

```bash
npx vitest run tests/crew/execution-launcher.test.ts tests/crew/lobby.test.ts
```

Expected: launcher contract tests pass and updated lobby tests pass.

- [ ] **Step 5: Write the complete close-precedence and rollback matrix**

Create `tests/crew/execution-attempts.test.ts` with `it.each` covering:

```typescript
const closeCases = [
  { completion: "done", cancellation: null, code: 1, signal: "SIGTERM", result: "completed" },
  { completion: "review_pending", cancellation: null, code: 0, signal: null, result: "review_pending" },
  { completion: null, cancellation: "user_stop", code: 1, signal: null, result: "cancelled" },
  { completion: null, cancellation: "orchestrator_shutdown", code: null, signal: "SIGKILL", result: "cancelled" },
  { completion: null, cancellation: null, code: 0, signal: null, result: "protocol_incomplete" },
  { completion: null, cancellation: null, code: 1, signal: null, result: "worker_crash" },
  { completion: null, cancellation: null, code: null, signal: "SIGTERM", result: "worker_crash" },
  { completion: "different_attempt", cancellation: null, code: 0, signal: null, result: "protocol_incomplete" },
] as const;
```

For cancellation, assert intent and every affected attempt are persisted before `proc.kill`; close restores `todo`, appends cancellation progress, clears assignment/current attempt, removes active attempt ID, and decrements `attempt_count` only when `attemptCharged && !rollbackApplied`. Reload files and replay close twice to prove rollback remains once.

- [ ] **Step 6: Run attempt tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-attempts.test.ts
```

Expected: FAIL because close classification and guarded rollback do not exist.

- [ ] **Step 7: Implement cancellation persistence and strict close classification**

Create `crew/execution/attempts.ts` with this pure classifier:

```typescript
export type CloseClassification =
  | { kind: "completed" | "review_pending" }
  | { kind: "cancelled"; cancellation: AttemptCancellation }
  | { kind: "protocol_incomplete"; blockedCode: "protocol_incomplete" }
  | { kind: "worker_crash"; blockedCode: "worker_crash" };
```

`classifyChildClose()` accepts the closing `attemptId`, task durable status/review state, attempt cancellation, exit code, and signal. Matching attempt completion/review wins; cancellation is second; code `0` is protocol-incomplete; every other close is worker-crash.

`persistCancellation()` first writes `SchedulerRecord.cancellationIntent`, then writes cancellation onto each attempt. `signalCancelledAttempts()` runs only after those writes. `reconcileChildClose()` atomically records close facts, applies classification, clears scheduler/task ownership, and invokes `applyRollbackOnce()` only for cancellation. Emit one corresponding event after durable writes.

Update `registry.ts` entries to include `attemptId`; replace direct destructive `killWorkerByTask`/`killAll` scheduler usage with lookup-only helpers plus controller cancellation. Keep compatibility wrappers temporarily for non-execution callers, marked for removal in Task 5.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-launcher.test.ts tests/crew/execution-attempts.test.ts tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
```

Expected: all focused tests pass.

```bash
git add -- crew/execution/tool-contract.ts crew/execution/launcher.ts crew/execution/attempts.ts crew/agents.ts crew/lobby.ts crew/registry.ts crew/spawn.ts tests/crew/execution-launcher.test.ts tests/crew/execution-attempts.test.ts tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
git diff --cached --check
git commit -m "feat: make worker attempts and exits durable"
```

---

### Task 4: Enforce attempt-scoped completion and durable legacy-review claims

**Files:**

- Create: `crew/execution/completion.ts`
- Create: `crew/execution/reviews.ts`
- Modify: `crew/handlers/task.ts:422-482`
- Modify: `crew/handlers/review.ts:58-171`
- Modify: `crew/store.ts:342-370,399-464`
- Modify: `crew/types.ts:70-125`
- Modify: `index.ts` tool parameter schema near the `pi_messenger` registration
- Modify: `crew/agents/crew-worker.md`
- Test: `tests/crew/execution-completion.test.ts`
- Test: `tests/crew/execution-reviews.test.ts`
- Modify test: `tests/crew/auto-review.test.ts`
- Modify test: `tests/crew/task-actions.test.ts`

**Interfaces:**

- Consumes: Trusted `process.env.PI_CREW_ATTEMPT_ID`, active attempt ownership, scheduler lease, and existing reviewer provider call.
- Produces: `completeOwnedAttempt(input): CompletionResult`, `claimPendingReview(input): ReviewClaimResult`, `commitReviewOutcome(input): ReviewCommitResult`, `recoverDeadReviewClaim(input): boolean`, and `invokeLegacyReviewer(cwd, taskId, model): Promise<ParsedReview>`.

- [ ] **Step 1: Write failing completion CAS tests**

Create `tests/crew/execution-completion.test.ts`. Seed task `task-1` with `current_attempt_id = attempt-a` and test both review configurations:

```typescript
it("commits the first owned completion and makes a duplicate an idempotent no-op", () => {
  const first = completeOwnedAttempt(input({ attemptId: attemptA, reviewEnabled: false }));
  const duplicate = completeOwnedAttempt(input({ attemptId: attemptA, reviewEnabled: false }));
  expect(first.kind).toBe("committed");
  expect(duplicate.kind).toBe("duplicate");
  expect(duplicate.task).toEqual(first.task);
  expect(store.getPlan(cwd)?.completed_count).toBe(1);
});

it.each([
  ["stale", attemptB],
  ["missing", undefined],
])("rejects a %s attempt without mutating evidence", (_label, attemptId) => {
  const before = store.getTask(cwd, taskId);
  expect(completeOwnedAttempt(input({ attemptId }))).toMatchObject({ kind: "rejected" });
  expect(store.getTask(cwd, taskId)).toEqual(before);
});
```

Assert review-disabled completion writes attempt-scoped evidence and `done`; review-enabled completion writes the same evidence, status `review_pending`, and `{ version: 1, state: "pending", reviewCount: 0, attemptId }`. Assert dependency readiness remains false until `done`.

- [ ] **Step 2: Run completion tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-completion.test.ts
```

Expected: FAIL because `completeOwnedAttempt` does not exist and current completion is status-only.

- [ ] **Step 3: Implement attempt-scoped completion and route `task.done` through it**

Create `crew/execution/completion.ts`. Perform one synchronous read/validate/write sequence. A duplicate is recognized only when durable completion/review evidence has the same `attemptId`; return the already committed task without incrementing counts or rewriting timestamps. Reject missing, stale, foreign, closed, or no-longer-owned attempts.

Update `taskDone()` to obtain the trusted attempt from `params.attemptId ?? process.env.PI_CREW_ATTEMPT_ID`, call `completeOwnedAttempt()`, and request scheduler reconciliation with `durable_completion`. Add optional `attemptId` to `CrewParams` for test/internal routing, but do not add it to the public TypeBox schema: worker processes receive it through the launcher environment. Update `crew-worker.md` to state that `task.done` is bound automatically to its launched attempt and must not be called from another process.

Replace `completeTask()` internals with the CAS helper or retain it only as a test/setup compatibility wrapper that rejects execution-owned tasks. Recompute plan `completed_count` from durable `done` tasks rather than incrementing a stale count.

- [ ] **Step 4: Run completion tests and verify GREEN**

Run:

```bash
npx vitest run tests/crew/execution-completion.test.ts tests/crew/task-actions.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Write the durable review state-machine and crash-window tests**

Create `tests/crew/execution-reviews.test.ts` with fake lease/process liveness and an invocation spy. Cover:

```typescript
it.each([
  ["SHIP", "done", "ship"],
  ["NEEDS_WORK", "todo", "needs_work"],
  ["MAJOR_RETHINK", "blocked", "major_rethink"],
])("commits %s exactly once", (outcome, taskStatus, reviewState) => {
  const claim = claimPendingReview(claimInput());
  const first = commitReviewOutcome(commitInput(claim, outcome));
  const duplicate = commitReviewOutcome(commitInput(claim, outcome));
  expect(first.kind).toBe("committed");
  expect(duplicate.kind).toBe("duplicate");
  expect(store.getTask(cwd, taskId)).toMatchObject({ status: taskStatus, legacy_review_state: { state: reviewState } });
});
```

Add unavailable, malformed, and provider-failure rows expecting `failed` plus actionable `blocked_reason`. Test claim-token/controller/attempt/run/lease mismatch rejection. Test pause after claim: no new provider work starts, but the live claimant commits. Test crash before invocation (claim is recovered only after claimant death), crash after invocation before commit (dead claim returns to pending and invokes at least once again), and crash after commit (replay is a no-op). Test startup scan order (`review_pending`, then `claiming`, before dispatch). Test fail-closed pause leaves pending unclaimed until explicit authorization.

For `NEEDS_WORK`, assert prior evidence is represented in progress/history, old completion ownership is cleared, retry eligibility respects active wave/continuous authorization and `maxAttemptsPerTask`, and the next dispatch receives a different attempt UUID. Late close/`task.done`/review outcome for the old attempt must not overwrite the new attempt.

- [ ] **Step 6: Run review tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-reviews.test.ts
```

Expected: FAIL because reviews are currently transient post-process actions.

- [ ] **Step 7: Implement claim, invocation, recovery, and exact-once outcome commit**

Create `crew/execution/reviews.ts` with:

```typescript
export interface ReviewClaim {
  taskId: string;
  attemptId: string;
  claimToken: string;
  controllerId: string;
  claimedAt: string;
}
```

`claimPendingReview()` requires valid lease/run and dispatch authorization, then atomically changes `pending -> claiming` with fresh token/controller/timestamp. `commitReviewOutcome()` requires active lease, run ID, claim token, controller ID, and attempt ID, but intentionally does not require dispatch authorization after claim.

Refactor `reviewImplementation()` into `invokeLegacyReviewer()` that only builds the existing diff/prompt, invokes `crew-reviewer`, and returns parsed data; it must not mutate task JSON. Scheduler review handling calls claim, persists/emits `task.review_claimed`, invokes, then commits and emits `task.review_completed` or `task.review_failed`.

Map outcomes exactly: SHIP → `done`; NEEDS_WORK → `todo` with bounded-retry eligibility under still-active authorization; MAJOR_RETHINK → `blocked` with reviewer summary; provider unavailable/nonzero, malformed verdict, or missing review inputs → `failed` and actionable block reason/failure code. Recover `claiming -> pending` only after proving the claimant process dead.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-completion.test.ts tests/crew/execution-reviews.test.ts tests/crew/auto-review.test.ts tests/crew/task-actions.test.ts
```

Expected: all focused tests pass.

```bash
git add -- crew/execution/completion.ts crew/execution/reviews.ts crew/handlers/task.ts crew/handlers/review.ts crew/store.ts crew/types.ts index.ts crew/agents/crew-worker.md tests/crew/execution-completion.test.ts tests/crew/execution-reviews.test.ts tests/crew/auto-review.test.ts tests/crew/task-actions.test.ts
git diff --cached --check
git commit -m "feat: make completion and legacy review attempt scoped"
```

---

### Task 5: Install one controller and convert commands, planning, and task mutations into adapters

**Files:**

- Create: `crew/execution/controller.ts`
- Create: `crew/execution/runtime.ts`
- Modify: `crew/index.ts:1-240`
- Modify: `crew/handlers/work.ts:23-373`
- Modify: `crew/handlers/plan.ts:139-164,200-541`
- Modify: `crew/handlers/task.ts:19-57,372-416,618-645`
- Modify: `crew/task-actions.ts:22-123`
- Modify: `crew/store.ts:120-154,280-310,399-443`
- Modify: `index.ts:513-582,803-846,940-971,977-1128`
- Test: `tests/crew/execution-controller.test.ts`
- Modify test: `tests/crew/work-stop.test.ts`
- Modify test: `tests/crew/plan-replan.test.ts`
- Modify test: `tests/crew/task-actions.test.ts`

**Interfaces:**

- Consumes: Lease, scheduler, selector, launcher, completion/review/attempt reconcilers from Tasks 1–4.
- Produces: `getExecutionController(cwd, deps): Promise<ExecutionController>`, `authorizeWork({ autonomous, concurrency, requestedBy })`, `authorizeTarget({ taskId, requestedBy })`, `pause(requestedBy)`, `stop(requestedBy, kind)`, `notify(reason, facts?)`, `awaitIdle()`, and `shutdown(requestedBy)`.

- [ ] **Step 1: Write failing controller authorization tests**

Create `tests/crew/execution-controller.test.ts` with fake launcher/reviewer and real temp persistence. Cover:

```typescript
it("authorizes a fixed wave snapshot for omitted or false autonomous", async () => {
  await controller.authorizeWork({ autonomous: false, requestedBy: "human" });
  await controller.awaitIdle();
  expect(readSchedulerRecord(cwd)).toMatchObject({ mode: "wave", waveSnapshotTaskIds: ["task-1", "task-2"] });
  markDone("task-1");
  makeDependencyReady("task-3");
  controller.notify("dependency_mutation");
  await controller.awaitIdle();
  expect(launchedTaskIds()).not.toContain("task-3");
});

it("continuous mode refills and includes newly ready work", async () => {
  await controller.authorizeWork({ autonomous: true, requestedBy: "human" });
  completeAttempt("task-1");
  controller.notify("durable_completion");
  await controller.awaitIdle();
  expect(launchedTaskIds()).toContain("task-3");
});

it("targeted authorization is consumed after launch or refusal", async () => {
  await controller.authorizeTarget({ taskId: "task-2", requestedBy: "human" });
  await controller.awaitIdle();
  expect(readSchedulerRecord(cwd)?.mode).toBe("idle");
  expect(launchedTaskIds()).toEqual(["task-2"]);
});
```

Add pause, stop, replan, task deletion, plan deletion, run replacement, and lease-loss invalidation cases. Assert user stop invalidates unconsumed authorization before signals. Assert a `NEEDS_WORK` snapshot task retries only while its wave remains authorized. Assert no command handler directly calls `spawnAgents`, `spawnWorkersForReadyTasks`, `spawnSingleWorker`, `spawnWorkerForTask`, or `assignTaskToLobbyWorker`.

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-controller.test.ts
```

Expected: FAIL because runtime/controller adapters do not exist.

- [ ] **Step 3: Implement the per-repository controller runtime**

Create `crew/execution/runtime.ts` as a normalized-cwd map. Do not create controllers in worker subprocesses (`PI_CREW_WORKER === "1"`). A controller initialization sequence is exactly:

```typescript
const plan = ensurePlanRunId(cwd);
const acquisition = acquireControllerLease(cwd, plan.run_id, randomUUID());
if (!acquisition.acquired) return readOnlyController(acquisition);
const prior = readSchedulerRecord(cwd);
const initial = prior
  ? interruptPriorRecord(prior, acquisition.lease, now())
  : idleRecord(plan.run_id, acquisition.lease);
writeSchedulerRecord(cwd, initial);
return createExecutionController(deps);
```

`interruptPriorRecord()` sets `mode: "paused"`, `interruptedAt`, and new controller/epoch, retains `activeAttemptIds` and cancellation intent, and clears launch authorization. The controller supplies scheduler dependencies for live process verification, task/config/reservation reads, launch, review, close reconciliation, event persistence, and lobby retirement.

- [ ] **Step 4: Replace `work` and `work.stop` implementation with command adapters**

Reduce `crew/handlers/work.ts` to validation/result formatting around:

```typescript
const ack = await controller.authorizeWork({
  autonomous: params.autonomous === true,
  concurrency: params.concurrency,
  requestedBy: state.agentName || "human",
});
return result(ack.message, { mode: "work", authorization: ack.authorization, readOnly: ack.readOnly });
```

Route `work.stop` to `controller.stop(requestedBy, "user_stop")`. Remove worker launching, post-hoc result classification, auto-review, and autonomous-wave loops from this handler. Keep `state-autonomous.ts` only as a compatibility projection of scheduler state for old session entries/overlay display; it must no longer authorize or launch work.

- [ ] **Step 5: Route targeted starts and invalidating mutations through the controller**

Change explicit orchestrator task start to `authorizeTarget()`. Worker-side `task.start` remains an idempotent acknowledgement only when trusted environment attempt ID matches current ownership; it cannot create a second attempt.

Before replan, task delete/reset/cascade reset, plan deletion, or run replacement: call `controller.pause()`, persist invalidation, reconcile/cancel affected attempts, then mutate plan/tasks. Reject replan while verified live attempts or claimed reviews remain. After dependency or configuration mutations call `controller.notify("dependency_mutation")` or `controller.notify("configuration")` rather than launching.

Update `crew/task-actions.ts` stop/delete/reset branches to call controller methods; remove direct `killWorkerByTask` and direct in-progress→todo writes.

- [ ] **Step 6: Wire extension lifecycle and planning `autoWork`**

On non-worker `session_start`, initialize the controller after messenger directories are known. Planning success with `autoWork: true` calls continuous authorization directly—no model turn and no overlay spawn callback. `turn_end`, `agent_end`, task completion, review completion, config controls, and dependency mutations only notify the scheduler.

Expose the test hook from `crew/execution/runtime.ts`:

```typescript
export async function awaitSchedulerIdle(cwd: string): Promise<void> {
  const controller = controllers.get(normalizeCwd(cwd));
  if (controller) await controller.awaitIdle();
}
```

- [ ] **Step 7: Run focused adapter tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-controller.test.ts tests/crew/work-stop.test.ts tests/crew/plan-replan.test.ts tests/crew/task-actions.test.ts tests/crew/agent-end-autonomous.test.ts
```

Expected: all focused tests pass; no adapter test observes a direct spawn call.

```bash
git add -- crew/execution/controller.ts crew/execution/runtime.ts crew/index.ts crew/handlers/work.ts crew/handlers/plan.ts crew/handlers/task.ts crew/task-actions.ts crew/store.ts index.ts tests/crew/execution-controller.test.ts tests/crew/work-stop.test.ts tests/crew/plan-replan.test.ts tests/crew/task-actions.test.ts tests/crew/agent-end-autonomous.test.ts
git diff --cached --check
git commit -m "refactor: route execution through one controller"
```

---

### Task 6: Reconcile restart survivors, claimed reviews, lobby capacity, overlay controls, and shutdown

**Files:**

- Create: `crew/execution/recovery.ts`
- Modify: `crew/execution/controller.ts`
- Modify: `crew/execution/runtime.ts`
- Modify: `crew/lobby.ts:214-365`
- Modify: `crew/registry.ts:40-114`
- Modify: `overlay-actions.ts:62-102,133-260,361-511`
- Modify: `overlay-coordinator.ts`
- Modify: `index.ts:803-846,1095-1128`
- Test: `tests/crew/execution-recovery.test.ts`
- Test: `tests/crew/execution-capacity.test.ts`
- Modify test: `tests/overlay-coordinator.test.ts`
- Modify test: `tests/crew/lobby.test.ts`
- Modify test: `tests/crew/graceful-shutdown.test.ts`

**Interfaces:**

- Consumes: Interrupted scheduler record, attempt/task/review files, process-liveness checks, registry entries, overlay commands.
- Produces: `reconcileStartup(input): RecoveryResult`, `computeCapacity(input): CapacityResult`, read-only overlay rendering, and durable orchestrator shutdown cancellation.

- [ ] **Step 1: Write failing restart and survivor-accounting tests**

Create `tests/crew/execution-recovery.test.ts` with these scenarios:

```typescript
it("fails closed on restart while retaining a verified live survivor", async () => {
  seedPriorContinuousRecord([attemptA]);
  seedRunningAttempt(attemptA, { pid: 404, taskId: "task-1" });
  const controller = await restart({ livePids: new Set([404]) });
  expect(controller.record()).toMatchObject({ mode: "paused", activeAttemptIds: [attemptA] });
  expect(launcher).not.toHaveBeenCalled();
  expect(controller.capacity().activeAssigned).toBe(1);
});

it("does not adopt or signal a surviving child until explicit cancellation", async () => {
  const controller = await restartWithSurvivor();
  await controller.authorizeWork({ autonomous: false, requestedBy: "human" });
  await controller.awaitIdle();
  expect(launchedTaskIds()).not.toContain("task-1");
  expect(signalSpy).not.toHaveBeenCalled();
});
```

Also cover dead survivor close reconciliation, matching durable completion before close, stale claimed review with live claimant (leave claiming), dead claimant (return pending), pending review under pause (do not invoke), explicit reauthorization (reviews before retries/dependents), changed run ID/lease loss/replan, and no automatic resume of previous wave/continuous/target/retry.

- [ ] **Step 2: Write failing capacity and overlay tests**

Create `tests/crew/execution-capacity.test.ts`. Assert active assigned workers consume slots; verified restart survivors consume slots; idle lobby workers do not; warm pool never exceeds desired concurrency; lowering concurrency retains assigned workers and retires only excess idle lobby workers; configuration changes request one reconciliation.

Update `tests/overlay-coordinator.test.ts` to inject an `ExecutionController` command facade and assert overlay buttons call `authorizeWork`, `authorizeTarget`, `pause`, `stop`, and `setConcurrency`, while spawn API spies remain untouched.

- [ ] **Step 3: Run recovery/capacity/overlay tests and verify RED**

Run:

```bash
npx vitest run tests/crew/execution-recovery.test.ts tests/crew/execution-capacity.test.ts tests/overlay-coordinator.test.ts
```

Expected: FAIL because startup reconciliation and command-only overlay integration are incomplete.

- [ ] **Step 4: Implement fail-closed startup reconciliation**

Create `crew/execution/recovery.ts`. Reconcile in this order before any launch selection:

1. validate current lease and plan run;
2. scan scheduler `activeAttemptIds`, retain verified live PIDs, and classify proven-dead attempts;
3. reconcile task durable completion/review state for each attempt;
4. scan `review_pending` tasks;
5. inspect `claiming` reviews and revert only dead claimants to pending;
6. return paused state and capacity facts without starting provider/process work.

A survivor is counted but never re-registered as controllable ownership. Explicit work authorization may launch other tasks only in remaining slots; it cannot launch the survivor’s task again. Only explicit stop/shutdown persists cancellation and signals a survivor.

- [ ] **Step 5: Implement capacity and warm-pool reconciliation**

Add `computeCapacity()` returning:

```typescript
export interface CapacityResult {
  desired: number;
  activeAssigned: number;
  idleLobby: number;
  availableTaskSlots: number;
  excessIdleLobby: number;
}
```

The controller calls `retireIdleLobbyWorkers(excessIdleLobby)` only after persisting the scheduler/config decision. Never terminate assigned workers when desired concurrency decreases. Scheduler dispatch uses `availableTaskSlots`; lobby warming uses `desired - activeAssigned - idleLobby`, bounded at zero.

- [ ] **Step 6: Convert overlay and shutdown to controller commands**

Change overlay callbacks to a narrow facade:

```typescript
interface OverlayExecutionCommands {
  authorizeWork(autonomous: boolean): Promise<void>;
  authorizeTarget(taskId: string): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  setConcurrency(value: number): Promise<void>;
}
```

Remove imports of `crew/spawn.ts`, `crew/lobby.ts`, and process-kill APIs from overlay files. Rendering reads scheduler/task state only.

On `session_shutdown`, call `controller.shutdown("orchestrator")`: persist mode/invalidation and `orchestrator_shutdown` cancellation intent, persist affected attempts, then deliver graceful shutdown/signals. Await reconciliation up to the existing configured grace boundary; do not mark shutdown cancellation resumable.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
npx vitest run tests/crew/execution-recovery.test.ts tests/crew/execution-capacity.test.ts tests/overlay-coordinator.test.ts tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
```

Expected: all focused tests pass.

```bash
git add -- crew/execution/recovery.ts crew/execution/controller.ts crew/execution/runtime.ts crew/lobby.ts crew/registry.ts overlay-actions.ts overlay-coordinator.ts index.ts tests/crew/execution-recovery.test.ts tests/crew/execution-capacity.test.ts tests/overlay-coordinator.test.ts tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
git diff --cached --check
git commit -m "feat: reconcile interrupted execution safely"
```

---

### Task 7: Complete the deterministic Phase 1A regression matrix and remove obsolete launch authority

**Files:**

- Create: `tests/crew/execution-phase-1a.test.ts`
- Modify: `tests/helpers/temp-dirs.ts`
- Modify: `tests/crew/state.test.ts`
- Modify: `tests/crew/worker-coordination.test.ts`
- Modify: `tests/crew/router-status.test.ts`
- Modify: `README.md` Crew execution/review sections
- Delete or reduce exports: `crew/spawn.ts`
- Delete obsolete autonomous launch logic: `crew/state-autonomous.ts`

**Interfaces:**

- Consumes: Complete execution controller and `awaitSchedulerIdle(cwd)`.
- Produces: One deterministic end-to-end regression suite proving every approved Phase 1A invariant and documentation matching the new command semantics.

- [ ] **Step 1: Add a reusable no-sleep execution harness**

Extend `tests/helpers/temp-dirs.ts` with `createExecutionHarness()` that provides a temp Crew tree, fixed UUID queue, fixed clock, fake process table, fake launcher/reviewer, persisted-event reader, controller restart helper, and:

```typescript
async function settle(): Promise<void> {
  await awaitSchedulerIdle(cwd);
}
```

The harness must throw if a test calls `setTimeout`, advances real time, launches `pi`, or consumes an unseeded UUID.

- [ ] **Step 2: Write the full Phase 1A acceptance suite**

Create `tests/crew/execution-phase-1a.test.ts` with nested `describe` blocks matching the design’s deterministic test list:

```typescript
describe("authorization matrix", () => { /* idle, wave, continuous, targeted, paused */ });
describe("wave review drain", () => { /* pending, claiming, SHIP, NEEDS_WORK */ });
describe("single-flight reconciliation", () => { /* dedupe and pending pass */ });
describe("selection and capacity", () => { /* retry order, shrink, warm pool */ });
describe("launcher contract", () => { /* ordinary and lobby tool args */ });
describe("child close precedence", () => { /* every Task 3 row */ });
describe("completion CAS", () => { /* commit, duplicate, stale, foreign */ });
describe("review crash boundaries", () => { /* before invoke, after invoke, after commit */ });
describe("NEEDS_WORK isolation", () => { /* fresh attempt and late-old events */ });
describe("restart and takeover", () => { /* pause, manual reauth, survivor slots */ });
describe("lease and plan invalidation", () => { /* replan, delete, run change */ });
describe("canonical events", () => { /* reason sets and total ordering */ });
describe("idle semantics", () => { /* wave drain and continuous waiting */ });
```

Use the exact tables already established in focused tests rather than sleep/polling. Each case must assert final task JSON, attempt JSON, scheduler JSON, emitted event order, and launcher/reviewer call count where applicable.

- [ ] **Step 3: Run the acceptance suite and verify RED if any integration is missing**

Run:

```bash
npx vitest run tests/crew/execution-phase-1a.test.ts
```

Expected: all cases pass; if an integration seam is missing, the failing assertion identifies its durable record or event-order discrepancy. Fix only the implicated execution module and rerun this command until green.

- [ ] **Step 4: Remove obsolete launch authority and update compatibility tests**

Search imports and ensure only `crew/execution/launcher.ts` invokes task-worker spawn/assignment. Reduce `crew/spawn.ts` to a deprecated non-exported compatibility shim or delete it when no imports remain. Reduce `state-autonomous.ts` to read-only legacy session deserialization, or delete it after moving overlay display to scheduler state. Update existing state, coordination, and router tests to assert controller state rather than transient autonomous-wave state.

Run this guard:

```bash
rg -n 'spawnWorkersForReadyTasks|spawnSingleWorker|spawnWorkerForTask|assignTaskToLobbyWorker|killWorkerByTask|killAll' --glob '*.ts' .
```

Expected: task-launch and kill calls appear only inside `crew/execution/`, low-level launcher/lobby/registry definitions, and tests; `crew/handlers/`, `overlay*.ts`, and planning code contain none.

- [ ] **Step 5: Update operator-facing execution documentation**

Update `README.md` to state:

- ordinary `work` authorizes one fixed wave;
- `work { autonomous: true }` authorizes continuous refill;
- task start is one targeted attempt;
- pause/stop/restart invalidate dispatch and require explicit reauthorization;
- review-enabled completion remains pending until legacy review commits;
- clean process exit without `task.done` blocks as protocol-incomplete;
- interrupted controllers fail closed and do not auto-resume.

Do not document Phase 1B pause recovery, observability, provider/model evaluation, or Phase 2 review packages.

- [ ] **Step 6: Run proactive diagnostics**

Run LSP diagnostics on all changed TypeScript files before the build/test commands. Resolve every error and warning introduced by Phase 1A, especially stale imports from removed launch paths and mismatched execution type unions.

- [ ] **Step 7: Run the complete verification suite**

Run:

```bash
npm test
npx tsc --noEmit
git diff --check
```

Expected: all Vitest files pass, TypeScript exits 0, and `git diff --check` exits 0.

- [ ] **Step 8: Commit the completed Phase 1A regression and documentation**

```bash
git add -- tests/crew/execution-phase-1a.test.ts tests/helpers/temp-dirs.ts tests/crew/state.test.ts tests/crew/worker-coordination.test.ts tests/crew/router-status.test.ts README.md crew/spawn.ts crew/state-autonomous.ts
git add -u -- crew/spawn.ts crew/state-autonomous.ts
git diff --cached --check
git commit -m "test: lock Phase 1A execution correctness"
```

- [ ] **Step 9: Verify the final branch state**

Run:

```bash
npm test
npx tsc --noEmit
git status --short
git log --oneline -7
```

Expected: tests and typecheck pass; status contains no tracked changes; the log shows seven Phase 1A task commits. The pre-existing untracked `.pi-subagents/` directory may remain untouched.

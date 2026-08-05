# Team Minimum-Safe Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Team while making Crew child permissions, automatic execution, lobby workers, approvals, ownership, review, retry, and provider-error handling safe enough to merge.

**Architecture:** Add one fail-closed child-action check before Crew routing and make `work` the only automatic execution owner. Keep Team as metadata and policy around Crew; use small pure helpers for approval, lobby compatibility, retry, and review decisions instead of a new scheduler.

**Tech Stack:** TypeScript, Node.js child processes, TypeBox tool schemas, Vitest, Pi extension APIs.

## Global Constraints

- Crew remains the only execution engine and dispatcher.
- Team remains optional and supplies roles, guidance, risk labels, approval state, and model preferences.
- New child actions are denied until explicitly allowed.
- Overlay rendering must not mutate task execution state.
- Fresh and lobby workers share one concurrency, result, review, and retry lifecycle.
- Keep code small and local; do not add a scheduler, lease system, process manager, or generic capability framework.
- Do not implement strict SDD dependency mode in this plan.
- Do not publish, release, push, merge, or remove worktrees without explicit approval.

## File Responsibility Map

- `crew/child-actions.ts`: pure child-action allowlist.
- `crew/index.ts`: apply the allowlist before action routing.
- `crew/utils/child-process.ts`: single trusted Crew-child identity check.
- `index.ts`: suppress controller-only outer policy for every Crew child.
- `crew/agents.ts`, `crew/lobby.ts`: shared worker launch guidance and child markers.
- `crew/registry.ts`: process-local lobby metadata and completion promise.
- `crew/handlers/task.ts`: task ownership and active-task mutation guards.
- `crew/handlers/revise.ts`: revision-created Team metadata and approval gates.
- `overlay.ts`: display and explicit controls only; no render-time dispatch.
- `crew/handlers/work.ts`: concurrency, lobby assignment, worker results, review, retry, and autonomous continuation.
- `crew/utils/progress.ts`: narrow terminal provider-error classification.

---

### Task 1: Add the Fail-Closed Crew Child Action Allowlist

**Files:**
- Create: `crew/child-actions.ts`
- Modify: `crew/index.ts:38-271`
- Test: `tests/crew/router-status.test.ts`

**Interfaces:**
- Produces: `isCrewChildActionAllowed(action: string): boolean`
- Consumes: existing `isCrewChildProcess()` from `crew/utils/child-process.ts`

- [ ] **Step 1: Write the failing child-action matrix**

Add a table-driven test that launches `executeCrewAction` under each Crew child marker and proves that only these action forms are allowed:

```ts
const allowed = [
  "status", "list", "whois", "feed", "send", "broadcast",
  "reserve", "release", "task.show", "task.list", "task.ready",
  "task.progress", "task.done", "crew.status", "crew.agents",
];

const denied = [
  "plan", "plan.cancel", "work", "work.stop", "review", "sync",
  "team.setup", "team.profile.use", "team.charter.update", "team.memory.note",
  "task.create", "task.split", "task.start", "task.block", "task.unblock",
  "task.reset", "task.delete", "task.approve", "task.reject",
  "task.revise", "task.revise-tree",
];
```

For each denied action, expect `details.error === "controller_only"`. Include unknown action `future.action` and expect it to be denied for children.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm exec vitest -- run tests/crew/router-status.test.ts
```

Expected: denied actions currently reach their handlers or return errors other than `controller_only`.

- [ ] **Step 3: Add the small pure allowlist**

Create `crew/child-actions.ts`:

```ts
const CHILD_ACTIONS = new Set([
  "status", "list", "whois", "feed", "send", "broadcast",
  "reserve", "release", "task.show", "task.list", "task.ready",
  "task.progress", "task.done", "crew.status", "crew.agents",
]);

export function isCrewChildActionAllowed(action: string): boolean {
  return CHILD_ACTIONS.has(action);
}
```

In `executeCrewAction`, after registration and before the switch, reject every child action not in the set:

```ts
if (isCrewChildProcess() && !isCrewChildActionAllowed(action)) {
  return result(`Error: ${action} is controller-only.`, {
    mode: action,
    error: "controller_only",
  });
}
```

Remove the narrower approval-only child check because the central check replaces it.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm exec vitest -- run tests/crew/router-status.test.ts tests/crew/team-routing.test.ts
npm exec tsc -- --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crew/child-actions.ts crew/index.ts tests/crew/router-status.test.ts tests/crew/team-routing.test.ts
git commit -m "fix: restrict Crew child actions"
```

---

### Task 2: Apply Crew Child Identity to Superpowers Policy and Lobby Launches

**Files:**
- Modify: `index.ts:850-865`
- Modify: `crew/lobby.ts:55-130`
- Modify: `crew/agents.ts` to extract the existing worker launch-composition helper
- Test: `tests/crew/superpowers-launch.test.ts`
- Test: `tests/crew/lobby.test.ts`

**Interfaces:**
- Consumes: `isCrewChildProcess(): boolean`
- Produces: lobby launches with the same child marker, guard extension, and Superpowers worker guidance contract as fresh workers

- [ ] **Step 1: Write failing policy and lobby tests**

Add cases proving:

```ts
for (const env of [
  { PI_CREW_ROLE: "planner" },
  { PI_CREW_ROLE: "analyst" },
  { PI_CREW_ROLE: "worker" },
  { PI_LOBBY_ID: "lobby-1" },
]) {
  // before_agent_start must not append SUPERPOWERS_OUTER_POLICY_MARKER
}
```

Add active and inactive Superpowers launch tests for fresh and lobby workers. Every child launch expects:

- `PI_CREW_ROLE` with the actual child role
- `PI_CREW_WORKER=1` for implementation workers
- the child guard extension after the main extension
- no controller outer-policy authorization

When Superpowers is active, also expect selected worker guidance in the appended system prompt. When it is inactive, expect no Superpowers guidance while the child guard remains loaded.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts tests/crew/lobby.test.ts
```

Expected: planner/analyst/lobby markers are not consistently treated as children, and lobby lacks the worker guard/guidance composition.

- [ ] **Step 3: Use the trusted child check in `index.ts`**

Replace the conditional activation-flag check with:

```ts
const systemPrompt = applySuperpowersOuterPolicy(
  event.systemPrompt,
  superpowersState,
  isCrewChildProcess(),
);
```

Import `isCrewChildProcess` from `crew/utils/child-process.ts`.

- [ ] **Step 4: Reuse the existing worker launch composition in lobby**

Extract only the smallest shared helper needed from `crew/agents.ts`, for example:

```ts
export interface WorkerLaunchPolicy {
  extensionArgs: string[];
  env: Record<string, string>;
  systemPromptSuffix?: string;
}

export function prepareWorkerLaunchPolicy(
  cwd: string,
  role: "worker" | "reviewer" | "planner" | "analyst",
): WorkerLaunchPolicy;
```

The helper must call existing Superpowers selection and guidance logic; it must not create a second policy implementation. Every Crew subprocess appends `SUPERPOWERS_GUARD_PATH` as the general child-boundary extension, even when Superpowers guidance is inactive. `spawnLobbyWorker` applies the returned environment markers and optional prompt suffix. Inside the guard extension, bootstrap/policy stripping remains conditional where needed, but the Task 3 Bash boundary uses the generic Crew-child markers.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts tests/crew/superpowers-guard.test.ts tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add index.ts crew/agents.ts crew/lobby.ts tests/crew/superpowers-launch.test.ts tests/crew/lobby.test.ts
git commit -m "fix: preserve Crew child launch boundaries"
```

---

### Task 3: Block Nested Pi and Worktree Commands in Crew Children

**Files:**
- Modify: `crew/superpowers-guard.ts`
- Test: `tests/crew/superpowers-guard.test.ts`

**Interfaces:**
- Produces: `isForbiddenCrewChildCommand(command: string): boolean`
- Consumes: Pi's `tool_call` event for the built-in `bash` tool

- [ ] **Step 1: Write failing command-guard tests**

Register the guard extension and emit Bash tool calls. Prove these commands are blocked:

```ts
[
  "pi -p 'start another agent'",
  "npx pi -p 'nested agent'",
  "git worktree add ../other branch",
  "git worktree remove ../other",
]
```

Prove ordinary engineering commands remain allowed:

```ts
[
  "npm test",
  "git status --short",
  "git diff --check",
  "git branch --show-current",
]
```

The guard must block without asking for UI confirmation because Crew children run unattended.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts
```

Expected: the current guard does not inspect Bash calls.

- [ ] **Step 3: Add a narrow `tool_call` guard**

Use the documented Pi extension hook:

```ts
export function isForbiddenCrewChildCommand(command: string): boolean {
  return /(^|[;&|]\s*)(?:npx\s+)?pi(?:\s|$)/i.test(command)
    || /\bgit\s+worktree\s+(?:add|remove|move|prune)\b/i.test(command);
}

pi.on("tool_call", (event) => {
  if (event.toolName !== "bash") return;
  const command = (event.input as { command?: unknown }).command;
  if (typeof command === "string" && isForbiddenCrewChildCommand(command)) {
    return { block: true, reason: "Crew children cannot start nested Pi or manage worktrees." };
  }
});
```

Keep the matcher limited to direct nested Pi launch and mutating `git worktree` operations. This is a focused defense-in-depth check, not a shell sandbox; indirect command execution remains part of the explicitly deferred complete sandbox risk.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts tests/crew/superpowers-launch.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/superpowers-guard.ts tests/crew/superpowers-guard.test.ts
git commit -m "fix: block nested Crew child workflows"
```

---

### Task 4: Enforce Assigned-Worker Ownership for Task Progress and Completion

**Files:**
- Modify: `crew/handlers/task.ts:360-370,487-554`
- Test: `tests/crew/task-actions.test.ts`

**Interfaces:**
- Produces: `canMutateAssignedTask(task: Task, agentName: string, isChild: boolean): boolean`
- Consumes: `isCrewChildProcess()`

- [ ] **Step 1: Write failing ownership tests**

Add tests for an in-progress task assigned to `WorkerA`:

```ts
expect(await callAs("WorkerB", "task.done", task.id)).toMatchObject({
  details: { error: "not_owner" },
});
expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");

expect(await callAs("WorkerA", "task.done", task.id)).toMatchObject({
  details: { task: { status: "done" } },
});
```

Repeat the wrong-owner assertion for `task.progress`. Add a controller case proving explicit recovery remains allowed.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/task-actions.test.ts
```

Expected: another child can currently update or complete the task.

- [ ] **Step 3: Add one local ownership helper**

In `crew/handlers/task.ts`:

```ts
function isAssignedChild(task: Task, state: MessengerState): boolean {
  return !isCrewChildProcess() || task.assigned_to === state.agentName;
}
```

Before progress or completion mutation, return:

```ts
if (!isAssignedChild(task, state)) {
  return result(`Error: ${task.id} is assigned to ${task.assigned_to ?? "another worker"}.`, {
    mode: `task.${op}`,
    error: "not_owner",
    id: task.id,
  });
}
```

Do not introduce ownership tokens or persistence changes.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/task-actions.test.ts tests/crew/router-status.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/task.ts tests/crew/task-actions.test.ts
git commit -m "fix: enforce Crew task ownership"
```

---

### Task 5: Reject Structural Mutations While a Task Has an Active Worker

**Files:**
- Modify: `crew/handlers/task.ts:149-286,774-806`
- Modify: `crew/handlers/revise.ts:22-237`
- Test: `tests/crew/task-actions.test.ts`
- Test: `tests/crew/task-revise.test.ts`
- Test: `tests/crew/task-revise-tree.test.ts`

**Interfaces:**
- Consumes: existing `hasActiveWorker(cwd, taskId): boolean`
- Produces: consistent `{ error: "active_worker" }` responses before split/reset/revision mutation

- [ ] **Step 1: Write failing active-worker tests**

Register a live worker for a task, then assert that these operations fail without changing the task:

```ts
for (const action of ["task.split", "task.reset", "task.revise", "task.revise-tree"]) {
  expect(await invoke(action)).toMatchObject({ details: { error: "active_worker" } });
  expect(store.getTask(cwd, task.id)).toEqual(before);
}
```

For tree revision, register a worker on a descendant and prove the whole operation is rejected.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm exec vitest -- run tests/crew/task-actions.test.ts tests/crew/task-revise.test.ts tests/crew/task-revise-tree.test.ts
```

- [ ] **Step 3: Add early guards only**

Use the existing registry predicate before planner launch or any store write:

```ts
if (hasActiveWorker(cwd, task.id)) {
  return result(`Cannot ${operation} ${task.id} while its worker is active.`, {
    mode: `task.${operation}`,
    error: "active_worker",
    id: task.id,
  });
}
```

For tree revision, reject if any subtree task has an active worker. Keep the existing reset guard rather than adding another state system.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/task-actions.test.ts tests/crew/task-revise.test.ts tests/crew/task-revise-tree.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/task.ts crew/handlers/revise.ts tests/crew/task-actions.test.ts tests/crew/task-revise.test.ts tests/crew/task-revise-tree.test.ts
git commit -m "fix: guard active Crew tasks from mutation"
```

---

### Task 6: Preserve Team Approval Gates on Tree Revision

**Files:**
- Modify: `crew/handlers/revise.ts:180-215`
- Test: `tests/crew/task-revise-tree.test.ts`
- Test: `tests/crew/team-task-approval.test.ts`

**Interfaces:**
- Consumes: `teamStore.canonicalRoleForTask`, `teamStore.normalizeRiskLabels`, `teamStore.approvalForTask`
- Produces: `revisionTaskMetadata(cwd: string, source: Task, entry: RevisionEntry): Pick<Task, "role" | "risk_labels" | "approval">`

- [ ] **Step 1: Write failing revision approval tests**

Cover:

1. A rejected high-risk source produces a pending replacement.
2. A pending source produces a pending replacement.
3. An approved gated source still produces a fresh pending replacement.
4. An ungated source uses current Team classification.

Example assertion:

```ts
expect(created).toMatchObject({
  role: "worker",
  risk_labels: ["migration"],
  approval: { required: true, status: "pending" },
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/task-revise-tree.test.ts tests/crew/team-task-approval.test.ts
```

- [ ] **Step 3: Add a small metadata helper**

Use source role and labels as defaults, classify under current Team policy, and preserve the stronger gate:

```ts
function revisionTaskMetadata(cwd: string, source: Task) {
  const role = teamStore.canonicalRoleForTask(cwd, source.role);
  const riskLabels = teamStore.normalizeRiskLabels(source.risk_labels);
  const classified = teamStore.approvalForTask(cwd, role, riskLabels);
  const sourceWasGated = source.approval?.required === true;
  const approval = sourceWasGated
    ? { required: true as const, status: "pending" as const }
    : classified;
  return { role, risk_labels: riskLabels, approval };
}
```

Pass this metadata to `store.createTask`. Do not add a new approval engine.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/task-revise-tree.test.ts tests/crew/team-task-approval.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/revise.ts tests/crew/task-revise-tree.test.ts tests/crew/team-task-approval.test.ts
git commit -m "fix: preserve Team gates during revision"
```

---

### Task 7: Make Overlay Rendering Passive

**Files:**
- Modify: `overlay.ts:129-206,591-630`
- Modify: related imports in `overlay.ts`
- Test: `tests/overlay.test.ts`
- Test: `tests/crew/plan-replan.test.ts`

**Interfaces:**
- Removes: `checkAutoSpawnOnPlanComplete`, `checkAutoRefillWorkers`
- Preserves: explicit `handleTaskStart` and user-requested concurrency controls

- [ ] **Step 1: Replace auto-spawn tests with passive-render tests**

Add tests that render repeatedly after planning completes and after in-progress count decreases:

```ts
for (let i = 0; i < 3; i++) overlay.render(120);
expect(spawnWorkersForReadyTasks).not.toHaveBeenCalled();
expect(store.getTask(cwd, task.id)?.status).toBe("todo");
```

Compose this with a plan created using `autoWork: false`. Keep a separate test proving an explicit task-start key still calls the explicit start handler.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm exec vitest -- run tests/overlay.test.ts tests/crew/plan-replan.test.ts
```

Expected: render currently starts or refills workers.

- [ ] **Step 3: Remove render-time dispatch methods and calls**

Delete only:

- `checkAutoSpawnOnPlanComplete`
- `checkAutoRefillWorkers`
- their calls from `render`
- imports used only by those methods

Do not add an overlay scheduler flag. Keep planning status display and explicit user controls.

- [ ] **Step 4: Run overlay and planning tests**

```bash
npm exec vitest -- run tests/overlay.test.ts tests/overlay-coordinator.test.ts tests/crew/plan-replan.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add overlay.ts tests/overlay.test.ts tests/crew/plan-replan.test.ts
git commit -m "fix: keep overlay rendering passive"
```

---

### Task 8: Record and Check Lobby Worker Compatibility

**Files:**
- Modify: `crew/registry.ts`
- Modify: `crew/lobby.ts:49-275`
- Test: `tests/crew/lobby.test.ts`
- Test: `tests/crew/model-routing.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LobbyCompatibility {
  cwd: string;
  model?: string;
  role?: string;
  superpowersActive: boolean;
}

export function isLobbyWorkerCompatible(
  worker: LobbyWorker,
  required: LobbyCompatibility,
): boolean;
```

- [ ] **Step 1: Write failing compatibility tests**

Create lobby workers with different model, role, guidance mode, and cwd values. Assert exact compatibility:

```ts
expect(isLobbyWorkerCompatible(worker, same)).toBe(true);
expect(isLobbyWorkerCompatible(worker, { ...same, model: "other/model" })).toBe(false);
expect(isLobbyWorkerCompatible(worker, { ...same, role: "reviewer" })).toBe(false);
expect(isLobbyWorkerCompatible(worker, { ...same, superpowersActive: false })).toBe(false);
```

Also prove that failed compatibility leaves `assignedTaskId` and task state unchanged.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts
```

- [ ] **Step 3: Store four compatibility fields and compare them**

Add the metadata to `LobbyWorkerEntry` at spawn time. Normalize cwd using the existing `normalizeCwd` helper. Implement strict equality for model, role, and Superpowers mode.

Do not add fuzzy model matching or worker reconfiguration.

- [ ] **Step 4: Filter lobby candidates before assignment**

In `work.ts`, resolve task requirements first and select only a compatible worker. If none exists, leave the task for fresh `spawnAgents` execution.

- [ ] **Step 5: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add crew/registry.ts crew/lobby.ts crew/handlers/work.ts tests/crew/lobby.test.ts tests/crew/model-routing.test.ts tests/crew/team-work.test.ts
git commit -m "fix: match lobby workers to task requirements"
```

---

### Task 9: Apply One Concurrency Budget to Lobby and Fresh Workers

**Files:**
- Modify: `crew/handlers/work.ts:130-210`
- Test: `tests/crew/team-work.test.ts`
- Test: `tests/crew/spawn.test.ts`

**Interfaces:**
- Produces: `takeWorkSlots<T>(items: T[], limit: number): T[]`
- Consumes: `autonomousState.concurrency` as the already-clamped effective limit

- [ ] **Step 1: Write failing mixed-worker concurrency tests**

With three ready tasks, two available compatible lobby workers, and requested concurrency `1`, expect one total assignment. With concurrency `2`, expect two total assignments regardless of worker source.

```ts
expect(activeAssignments(cwd)).toHaveLength(2);
expect(spawnAgentsInput).toHaveLength(2 - lobbyAssignments);
```

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/team-work.test.ts tests/crew/spawn.test.ts
```

- [ ] **Step 3: Use one integer slot counter**

In `work.execute`:

```ts
let remainingSlots = autonomousState.concurrency;
// Assign at most remainingSlots compatible lobby workers.
remainingSlots -= lobbyAssigned.size;
// Slice fresh tasks to remainingSlots before spawnAgents.
```

Do not add a queue class. Existing active workers for this project must be counted before calculating open slots.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/team-work.test.ts tests/crew/spawn.test.ts tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/team-work.test.ts tests/crew/spawn.test.ts
git commit -m "fix: share Crew worker concurrency budget"
```

---

### Task 10: Join Lobby Worker Completion into the Work Wave

**Files:**
- Modify: `crew/registry.ts`
- Modify: `crew/lobby.ts:55-220,230-275`
- Modify: `crew/handlers/work.ts:140-340`
- Test: `tests/crew/lobby.test.ts`
- Test: `tests/crew/graceful-shutdown.test.ts`

**Interfaces:**
- Produces:

```ts
export function waitForLobbyWorker(worker: LobbyWorker): Promise<AgentResult>;
```

- Lobby worker entries hold one completion promise resolved by the existing process `close` handler.

- [ ] **Step 1: Write failing wave-ownership tests**

Assign an autonomous task to a warm lobby worker and assert:

- `work.execute` does not resolve before the worker exits.
- autonomous state does not stop as `blocked` while the task is in progress.
- the lobby result appears in the same `succeeded`, `failed`, or `blocked` processing as a fresh worker.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
```

- [ ] **Step 3: Add one completion promise to each lobby entry**

Create the promise during `spawnLobbyWorker`, resolve it from the existing `close` handler, and expose `waitForLobbyWorker`. Return the existing `AgentResult` shape:

```ts
{
  agent: "crew-worker",
  taskId: worker.assignedTaskId ?? undefined,
  exitCode: exitCode ?? 1,
  output: "",
  truncated: false,
  progress,
}
```

Mark assignments owned by `work` so the close handler does not independently reset a task that `work` will process.

- [ ] **Step 4: Await lobby and fresh results together**

In `work.execute`, collect lobby completion promises and combine their results with `spawnAgents` results before the existing result loop:

```ts
const [freshResults, lobbyResults] = await Promise.all([
  spawnAgents(workerTasks, cwd, spawnOptions),
  Promise.all(lobbyAssignments.map(waitForLobbyWorker)),
]);
const workerResults = [...freshResults, ...lobbyResults];
```

Do not add polling or a second autonomous callback.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts tests/crew/agent-end-autonomous.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add crew/registry.ts crew/lobby.ts crew/handlers/work.ts tests/crew/lobby.test.ts tests/crew/graceful-shutdown.test.ts
git commit -m "fix: keep lobby work inside Crew waves"
```

---

### Task 11: Use One Retry Rule for All Worker Failures

**Files:**
- Modify: `crew/handlers/work.ts:220-285`
- Test: `tests/crew/graceful-shutdown.test.ts`
- Test: `tests/crew/lobby.test.ts`

**Interfaces:**
- Produces:

```ts
function recordWorkerFailure(
  cwd: string,
  taskId: string,
  message: string,
  maxAttempts: number,
): "retry" | "blocked";
```

- [ ] **Step 1: Write failing fresh and lobby failure tests**

For both worker sources:

- failure before max attempts resets to `todo` and clears `assigned_to`
- failure at max attempts blocks and clears `assigned_to`
- non-autonomous failure does not leave `in_progress`
- autonomous failure does not block on the first attempt unless max is one

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts
```

- [ ] **Step 3: Add one local failure transition**

Implement only the two outcomes:

```ts
if (task.attempt_count >= maxAttempts) {
  store.updateTask(cwd, taskId, {
    status: "blocked",
    assigned_to: undefined,
    blocked_reason: `Max attempts (${maxAttempts}) reached`,
  });
  return "blocked";
}
store.updateTask(cwd, taskId, { status: "todo", assigned_to: undefined });
return "retry";
```

Call it for every non-graceful worker failure. Keep graceful shutdown text distinct, but clear ownership in the same way.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts tests/crew/agent-end-autonomous.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts
git commit -m "fix: unify Crew worker retry handling"
```

---

### Task 12: Fail Closed When Automatic Review Does Not Accept Work

**Files:**
- Modify: `crew/handlers/work.ts:285-335`
- Test: `tests/crew/auto-review.test.ts`
- Test: `tests/crew/graceful-shutdown.test.ts`

**Interfaces:**
- Produces:

```ts
function applyReviewOutcome(
  cwd: string,
  taskId: string,
  outcome: "SHIP" | "NEEDS_WORK" | "MAJOR_RETHINK" | "REVIEW_FAILED" | "REVIEW_EXHAUSTED",
): "accepted" | "retry" | "blocked";
```

- [ ] **Step 1: Add failing end-to-end review tests**

Mock a completed worker and the reviewer. Prove:

- exactly one reviewer call for one successful completion
- SHIP remains done
- NEEDS_WORK resets
- MAJOR_RETHINK blocks
- missing verdict blocks
- max review iterations blocks instead of silently accepting
- dependent tasks are not ready after any non-SHIP outcome

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts tests/crew/graceful-shutdown.test.ts
```

- [ ] **Step 3: Add one local outcome helper**

Map outcomes directly:

```ts
switch (outcome) {
  case "SHIP": return "accepted";
  case "NEEDS_WORK": store.resetTask(cwd, taskId); return "retry";
  default: store.blockTask(cwd, taskId, reviewReason(outcome)); return "blocked";
}
```

When review is enabled, do not leave a task accepted after reviewer absence, failure, missing verdict, or exhausted iterations. Keep the current review-count field; do not add a review state machine.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts tests/crew/graceful-shutdown.test.ts tests/crew/store.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/auto-review.test.ts tests/crew/graceful-shutdown.test.ts
git commit -m "fix: require accepted automatic reviews"
```

---

### Task 13: Keep Temporary Rate Limits Retryable

**Files:**
- Modify: `crew/utils/progress.ts:120-165`
- Test: `tests/crew/agent-events.test.ts`

**Interfaces:**
- Preserves: existing terminal assistant-event boundary
- Changes: generic 429 throttling is not terminal without durable quota/account evidence

- [ ] **Step 1: Write the failing classification matrix**

Add negative cases:

```ts
[
  "429: Too many requests",
  "429: Rate limit exceeded; retry after 10 seconds",
  "429: Requests per minute exceeded",
  "429: Tokens per minute exceeded",
]
```

These must not terminate the child. Keep positive terminal cases for invalid credentials, payment required, billing disabled, and quota exhausted with durable account language.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/agent-events.test.ts
```

Expected: generic 429 cases are currently classified as terminal.

- [ ] **Step 3: Narrow the phrase matcher**

Remove generic `rate limit`, `too many requests`, and bare `resource exhausted` phrases from terminal classification. Retain phrases tied to durable account state, for example:

```ts
/quota (?:is )?exhausted|billing|payment required|invalid api key|invalid credentials|account disabled/i
```

Keep the existing requirements for terminal assistant event, `stopReason: "error"`, and allowlisted HTTP status.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/agent-events.test.ts tests/crew/live-progress.test.ts tests/crew/utils/artifacts.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/utils/progress.ts tests/crew/agent-events.test.ts
git commit -m "fix: retry temporary provider rate limits"
```

---

### Task 14: Update Product Documentation for the Safe Team Boundary

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/reports/2026-08-04-upstream-v0.15.0-integration-report.md`
- Test: `tests/readme-branding.test.ts`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-13
- Produces: accurate user-facing Team, child-permission, `autoWork`, lobby, review, and rate-limit documentation

- [ ] **Step 1: Add documentation assertions before changing prose**

Extend branding/documentation tests to require short statements equivalent to:

- Crew children cannot dispatch or administer Team.
- `autoWork: false` leaves the plan idle for inspection.
- Team approval remains required after revision.
- Automatic implementations require accepted review when review is enabled.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/readme-branding.test.ts
```

- [ ] **Step 3: Update only affected documentation**

Add concise README text and changelog entries. Update the integration report with the independent review findings, repair commit list, test evidence, and remaining deferred risks. Do not claim publication or release.

- [ ] **Step 4: Run documentation tests and diff check**

```bash
npm exec vitest -- run tests/readme-branding.test.ts
npm exec tsc -- --noEmit
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/reports/2026-08-04-upstream-v0.15.0-integration-report.md tests/readme-branding.test.ts
git commit -m "docs: record safe Team integration behavior"
```

---

### Task 15: Run Final Verification and Independent Review

**Files:**
- Modify only if verification finds a confirmed defect; use a separate focused RED/GREEN commit for each defect
- Verify: all files changed since `3315090`

**Interfaces:**
- Consumes: Tasks 1-14
- Produces: merge-review evidence; no merge, push, publication, or release

- [ ] **Step 1: Run proactive diagnostics**

Run LSP diagnostics on every changed TypeScript file, then:

```bash
npm exec tsc -- --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Run focused safety suites**

```bash
npm exec vitest -- run \
  tests/crew/router-status.test.ts \
  tests/crew/team-routing.test.ts \
  tests/crew/superpowers-launch.test.ts \
  tests/crew/superpowers-guard.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/task-revise.test.ts \
  tests/crew/task-revise-tree.test.ts \
  tests/crew/team-task-approval.test.ts \
  tests/overlay.test.ts \
  tests/crew/plan-replan.test.ts \
  tests/crew/lobby.test.ts \
  tests/crew/model-routing.test.ts \
  tests/crew/team-work.test.ts \
  tests/crew/graceful-shutdown.test.ts \
  tests/crew/agent-end-autonomous.test.ts \
  tests/crew/auto-review.test.ts \
  tests/crew/agent-events.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run complete verification**

```bash
npm test
npm exec vitest -- run tests/evals
git diff --check 3315090..HEAD
npm pack --dry-run
```

Expected: all pass. Do not run live model-backed evals without explicit approval because they may consume provider credits.

- [ ] **Step 4: Run Lens diagnostics**

Run `lens_diagnostics` with `mode=all` for all files edited during implementation. Expected: no blocking errors or unresolved warnings.

- [ ] **Step 5: Request independent whole-branch review**

Review `3315090..HEAD` against:

- `docs/superpowers/specs/2026-08-05-team-minimum-safe-integration-design.md`
- this implementation plan

Do not proceed while any Critical or Important finding remains unresolved.

- [ ] **Step 6: Record final evidence**

Append exact commands, counts, diagnostics, review verdict, and remaining deferred risks to the integration report. Commit documentation only:

```bash
git add docs/superpowers/reports/2026-08-04-upstream-v0.15.0-integration-report.md
git commit -m "docs: complete safe Team integration review"
```

- [ ] **Step 7: Stop for user authorization**

Present the final branch, commit range, verification evidence, and review result. Do not push, open a PR, merge, publish, release, or remove the worktree until the user explicitly authorizes the next action.

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

### Task 2: Use General Crew Child Identity for Outer Policy

**Files:**
- Modify: `index.ts:850-865`
- Test: `tests/crew/superpowers-policy.test.ts`

**Interfaces:**
- Consumes: `isCrewChildProcess(): boolean`
- Produces: controller-only outer policy suppression for every Crew child marker

- [ ] **Step 1: Write the failing child-marker matrix**

Add cases for planner, analyst, worker, reviewer, and lobby markers. Each case must prove `before_agent_start` does not append `SUPERPOWERS_OUTER_POLICY_MARKER`.

```ts
for (const env of [
  { PI_CREW_ROLE: "planner" },
  { PI_CREW_ROLE: "analyst" },
  { PI_CREW_ROLE: "worker" },
  { PI_CREW_ROLE: "reviewer" },
  { PI_LOBBY_ID: "lobby-1" },
]) {
  expect(applyPolicyWithEnv(env)).not.toContain(SUPERPOWERS_OUTER_POLICY_MARKER);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-policy.test.ts
```

- [ ] **Step 3: Use the trusted child check**

```ts
const systemPrompt = applySuperpowersOuterPolicy(
  event.systemPrompt,
  superpowersState,
  isCrewChildProcess(),
);
```

Import `isCrewChildProcess` from `crew/utils/child-process.ts`. Remove the direct activation-flag comparison at this call site.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/superpowers-policy.test.ts tests/crew/superpowers-extension.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add index.ts tests/crew/superpowers-policy.test.ts
git commit -m "fix: suppress controller policy for Crew children"
```

---

### Task 3: Load the Child Guard for Every Crew Subprocess

**Files:**
- Modify: `crew/agents.ts:235-285`
- Modify: `crew/lobby.ts:75-130`
- Modify: `crew/superpowers-guard.ts:34-48`
- Test: `tests/crew/superpowers-launch.test.ts`
- Test: `tests/crew/lobby.test.ts`

**Interfaces:**
- Produces: every Crew subprocess loads `SUPERPOWERS_GUARD_PATH`
- Preserves: Superpowers prompt stripping only when the active guidance flag is present

- [ ] **Step 1: Write failing active and inactive launch tests**

For fresh planner, analyst, reviewer, worker, and lobby launches, assert the child guard extension is present after the main extension whether Superpowers is active or inactive. Also assert each process has the correct `PI_CREW_ROLE`.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts tests/crew/lobby.test.ts
```

- [ ] **Step 3: Always append the child guard extension**

Move this argument outside the active-guidance condition in both subprocess launch paths:

```ts
args.push("--extension", EXTENSION_DIR);
args.push("--extension", SUPERPOWERS_GUARD_PATH);
```

Change `registerSuperpowersGuard` so the extension loads for every Crew child. Keep bootstrap and outer-policy stripping conditional on the active Superpowers flag; the child-action and Bash guards use generic Crew markers.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts tests/crew/superpowers-guard.test.ts tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/agents.ts crew/lobby.ts crew/superpowers-guard.ts tests/crew/superpowers-launch.test.ts tests/crew/lobby.test.ts
git commit -m "fix: load Crew child guard consistently"
```

---

### Task 4: Apply Superpowers Worker Guidance to Lobby Workers

**Files:**
- Modify: `crew/agents.ts` to extract the existing guidance composition
- Modify: `crew/lobby.ts:55-145`
- Test: `tests/crew/lobby.test.ts`
- Test: `tests/crew/superpowers-launch.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkerGuidance {
  active: boolean;
  env: Record<string, string>;
  systemPromptSuffix?: string;
}

export function prepareWorkerGuidance(
  role: "worker" | "reviewer",
  assignmentId?: string,
): WorkerGuidance;
```

- [ ] **Step 1: Write failing lobby guidance tests**

With active Superpowers, expect the lobby worker's appended prompt to contain the selected worker guidance and its environment to contain the active child flag. With fallback or inactive Superpowers, expect no guidance suffix and no active flag.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/superpowers-launch.test.ts
```

- [ ] **Step 3: Extract only guidance preparation**

Implement `prepareWorkerGuidance` by calling the existing `prepareSuperpowersLaunch` and `renderSuperpowersGuidance`. Use it from fresh and lobby launch paths. Do not move model, tool, process, or registry logic into the helper.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts tests/crew/superpowers-launch.test.ts tests/crew/superpowers-extension.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/agents.ts crew/lobby.ts tests/crew/lobby.test.ts tests/crew/superpowers-launch.test.ts
git commit -m "fix: guide Superpowers lobby workers"
```

---

### Task 5: Block Nested Pi and Worktree Commands in Crew Children

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

### Task 6: Enforce Assigned-Worker Ownership for Task Progress and Completion

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

### Task 7: Reject Structural Mutations While a Task Has an Active Worker

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

### Task 8: Preserve Team Approval Gates on Tree Revision

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

### Task 9: Make Overlay Rendering Passive

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

### Task 10: Record and Check Lobby Worker Compatibility

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

### Task 11: Apply One Concurrency Budget to Lobby and Fresh Workers

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

### Task 12: Expose Lobby Worker Completion Results

**Files:**
- Modify: `crew/registry.ts`
- Modify: `crew/lobby.ts:55-220`
- Test: `tests/crew/lobby.test.ts`

**Interfaces:**
- Produces:

```ts
export function waitForLobbyWorker(worker: LobbyWorker): Promise<AgentResult>;
```

- [ ] **Step 1: Write a failing completion-result test**

Spawn a lobby worker, assign a task, emit process close, and assert `waitForLobbyWorker` resolves once with the assigned task ID, exit code, and final progress.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts
```

- [ ] **Step 3: Add one completion promise**

Create one promise and resolver on `LobbyWorkerEntry`. Resolve it from the existing close handler with the current `AgentResult` shape:

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

`waitForLobbyWorker` returns that promise. Do not add polling or events.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/registry.ts crew/lobby.ts tests/crew/lobby.test.ts
git commit -m "feat: expose lobby worker completion"
```

---

### Task 13: Give Work Exclusive Ownership of Assigned Lobby Results

**Files:**
- Modify: `crew/registry.ts`
- Modify: `crew/lobby.ts:178-220,230-275`
- Test: `tests/crew/lobby.test.ts`

**Interfaces:**
- Produces: `managedByWork: boolean` on process-local lobby entries
- Consumes: existing lobby close handler and task reset behavior

- [ ] **Step 1: Write failing double-mutation tests**

For a work-managed assignment, emit process close and assert the close handler does not reset or block the task. For a manually started lobby worker, assert the existing close-handler recovery still runs.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts
```

- [ ] **Step 3: Add one ownership flag**

Set `managedByWork = true` only when `work.execute` assigns the lobby worker. In the close handler:

```ts
if (worker.assignedTaskId && !worker.managedByWork) {
  recoverUnmanagedLobbyTask(...);
}
```

The flag is process-local and does not create persisted scheduler state.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/registry.ts crew/lobby.ts tests/crew/lobby.test.ts
git commit -m "fix: avoid duplicate lobby task recovery"
```

---

### Task 14: Await Work-Managed Lobby Workers

**Files:**
- Modify: `crew/handlers/work.ts:140-235`
- Test: `tests/crew/graceful-shutdown.test.ts`

**Interfaces:**
- Consumes: `waitForLobbyWorker(worker): Promise<AgentResult>`
- Produces: `work.execute` waits for both fresh and lobby workers before result processing

- [ ] **Step 1: Write the failing wait test**

Assign a ready task to a warm lobby worker. Assert `work.execute` remains pending until the mocked lobby process closes.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts
```

- [ ] **Step 3: Await both result sources**

```ts
const [freshResults, lobbyResults] = await Promise.all([
  spawnAgents(workerTasks, cwd, spawnOptions),
  Promise.all(lobbyAssignments.map(waitForLobbyWorker)),
]);
const workerResults = [...freshResults, ...lobbyResults];
```

Do not add a callback, polling loop, or second result processor.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/lobby.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/graceful-shutdown.test.ts
git commit -m "fix: await lobby workers in Crew work"
```

---

### Task 15: Process Lobby Results Through Review and Autonomous Continuation

**Files:**
- Modify: `crew/handlers/work.ts:220-405`
- Test: `tests/crew/graceful-shutdown.test.ts`
- Test: `tests/crew/auto-review.test.ts`

**Interfaces:**
- Consumes: combined `AgentResult[]` from fresh and lobby workers
- Produces: one result, review, and continuation path for both worker sources

- [ ] **Step 1: Write failing lobby lifecycle tests**

Prove a successful lobby task enters automatic review, a failed lobby task enters the normal failure list, and autonomous work does not stop as blocked before a lobby result is processed.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts
```

- [ ] **Step 3: Remove lobby-only exclusions**

Feed the combined result array into the existing result loop. Include lobby task IDs in `tasksAttempted`. Calculate autonomous continuation only after all combined results and reviews are applied.

Do not create a lobby-specific review or continuation function.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts tests/crew/agent-end-autonomous.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts
git commit -m "fix: process lobby results through Crew lifecycle"
```

---

### Task 16: Use One Retry Rule for All Worker Failures

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

### Task 17: Block Tasks When Automatic Review Cannot Run

**Files:**
- Modify: `crew/handlers/work.ts:285-335`
- Test: `tests/crew/auto-review.test.ts`

**Interfaces:**
- Produces:

```ts
function reviewUnavailableReason(
  hasReviewer: boolean,
  reviewCount: number,
  maxIterations: number,
  verdict?: string,
): string | undefined;
```

- [ ] **Step 1: Write failing unavailable-review tests**

Prove a completed automatic task becomes blocked when the reviewer agent is missing, the reviewer returns no verdict, or the task has exhausted review iterations.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts
```

- [ ] **Step 3: Block instead of skipping**

Return a short reason from `reviewUnavailableReason` and call `store.blockTask`. Remove silent `continue` branches that leave the task accepted. Keep existing review counters.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/auto-review.test.ts
git commit -m "fix: block tasks without automatic review"
```

---

### Task 18: Apply Automatic Review Verdicts Consistently

**Files:**
- Modify: `crew/handlers/work.ts:285-335`
- Test: `tests/crew/auto-review.test.ts`

**Interfaces:**
- Produces:

```ts
function applyReviewVerdict(
  cwd: string,
  taskId: string,
  verdict: "SHIP" | "NEEDS_WORK" | "MAJOR_RETHINK",
): "accepted" | "retry" | "blocked";
```

- [ ] **Step 1: Write failing verdict transition tests**

Run the real work result path and prove SHIP remains done, NEEDS_WORK resets to todo, and MAJOR_RETHINK blocks with reviewer context.

- [ ] **Step 2: Run and verify RED**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts
```

- [ ] **Step 3: Add the three-case helper**

```ts
switch (verdict) {
  case "SHIP": return "accepted";
  case "NEEDS_WORK": store.resetTask(cwd, taskId); return "retry";
  case "MAJOR_RETHINK": store.blockTask(cwd, taskId, reviewReason(taskId)); return "blocked";
}
```

Use it once for fresh and lobby results. Do not add a review state machine.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add crew/handlers/work.ts tests/crew/auto-review.test.ts tests/crew/graceful-shutdown.test.ts
git commit -m "fix: apply automatic review verdicts"
```

---

### Task 19: Prove One Review and Preserve Dependency Gates

**Files:**
- Test: `tests/crew/auto-review.test.ts`
- Test: `tests/crew/store.test.ts`

**Interfaces:**
- Consumes: automatic review behavior from Tasks 17-18
- Produces: regression coverage for review count and dependent readiness

- [ ] **Step 1: Add end-to-end review-count tests**

For one successful automatic completion, assert the reviewer is called exactly once. For NEEDS_WORK, MAJOR_RETHINK, missing review, and exhausted review, assert dependent tasks do not become ready.

- [ ] **Step 2: Run and verify test behavior**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts tests/crew/store.test.ts
```

Expected: pass if Tasks 17-18 fully implement the contract; otherwise fail for the missing behavior.

- [ ] **Step 3: Make only the smallest correction exposed by the tests**

If a test fails, adjust the existing result/review ordering in `crew/handlers/work.ts`; do not add new state. If all tests pass, make no production edit.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm exec vitest -- run tests/crew/auto-review.test.ts tests/crew/store.test.ts tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add tests/crew/auto-review.test.ts tests/crew/store.test.ts crew/handlers/work.ts
git commit -m "test: protect automatic review gates"
```

---

### Task 20: Keep Temporary Rate Limits Retryable

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

### Task 21: Update Product Documentation for the Safe Team Boundary

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/reports/2026-08-04-upstream-v0.15.0-integration-report.md`
- Test: `tests/readme-branding.test.ts`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-20
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

### Task 22: Run Final Verification and Independent Review

**Files:**
- Modify only if verification finds a confirmed defect; use a separate focused RED/GREEN commit for each defect
- Verify: all files changed since `3315090`

**Interfaces:**
- Consumes: Tasks 1-21
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

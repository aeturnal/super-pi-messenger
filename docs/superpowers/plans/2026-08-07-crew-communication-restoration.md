# Crew Communication Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Crew child registration, worker-owned task actions, live worker broadcasts, and visible overlay send errors without widening controller authority.

**Architecture:** Replace the flat child allowlist with a role-aware predicate using the existing `PI_CREW_ROLE` process marker. Reuse the existing task handlers, message delivery loop, inbox watcher, feed, and overlay notification state; only repair the boundaries that currently bypass or hide them.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Pi extension APIs, filesystem-backed messenger registry and inboxes.

## Global Constraints

- Keep planning, work dispatch, review dispatch, task creation and revision, approvals, and Team administration controller-only.
- Unknown child actions remain denied by default.
- Use `PI_CREW_ROLE`; fall back to `PI_CREW_WORKER` or `PI_LOBBY_ID` only for compatibility with existing worker processes and tests.
- A Crew child may mutate only its assigned in-progress task.
- Reuse `executeSend()` peer delivery; do not add another broadcast implementation or message format.
- Keep configured message budgets and one feed event per broadcast.
- Failed overlay sends preserve the typed message; successful sends keep clearing it.
- Do not change planning, scheduling, worktree behavior, model selection, or Team policy.
- Follow RED/GREEN TDD for every production change.

## Execution Graph

All four tasks are independent and may run concurrently. They touch separate production files and separate focused tests.

---

### Task 1: Role-aware Crew child action policy

**Files:**

- Modify: `crew/child-actions.ts`
- Modify: `crew/index.ts:49-58`
- Modify: `tests/crew/router-status.test.ts:90-178`

**Interfaces:**

- Consumes: `isCrewChildProcess(): boolean` from `crew/utils/child-process.ts` and process markers `PI_CREW_ROLE`, `PI_CREW_WORKER`, `PI_LOBBY_ID`.
- Produces: `getCrewChildRole(): CrewChildRole | undefined` and `isCrewChildActionAllowed(action: string, role?: CrewChildRole): boolean` from `crew/child-actions.ts`.
- Dependencies: none.

- [ ] **Step 1: Replace the flat-matrix expectation with failing role-matrix tests**

In `tests/crew/router-status.test.ts`, import the policy functions and replace the current shared “safe action matrix” test with explicit role expectations:

```ts
import {
  getCrewChildRole,
  isCrewChildActionAllowed,
} from "../../crew/child-actions.ts";

it("allows mesh actions for every Crew child role", () => {
  const shared = [
    "join", "status", "list", "whois", "feed", "set_status",
    "send", "broadcast", "task.show", "task.list", "task.ready",
    "crew.status", "crew.agents",
  ];

  for (const role of ["planner", "reviewer", "analyst", "worker"] as const) {
    for (const action of shared) {
      expect(isCrewChildActionAllowed(action, role), `${role}:${action}`).toBe(true);
    }
  }
});

it("allows task execution actions only for workers", () => {
  const workerActions = [
    "reserve", "release", "task.start", "task.progress", "task.done", "task.block",
  ];

  for (const action of workerActions) {
    expect(isCrewChildActionAllowed(action, "worker"), action).toBe(true);
    expect(isCrewChildActionAllowed(action, "planner"), action).toBe(false);
    expect(isCrewChildActionAllowed(action, "reviewer"), action).toBe(false);
    expect(isCrewChildActionAllowed(action, "analyst"), action).toBe(false);
  }
});

it("keeps orchestration, approval, Team, and unknown actions controller-only", () => {
  const denied = [
    "autoRegisterPath", "plan", "plan.cancel", "work", "work.stop",
    "review", "sync", "team.setup", "team.profile.use",
    "team.charter.update", "team.memory.note", "task.create", "task.split",
    "task.unblock", "task.reset", "task.delete", "task.approve",
    "task.reject", "task.revise", "task.revise-tree", "future.action",
  ];

  for (const role of ["planner", "reviewer", "analyst", "worker"] as const) {
    for (const action of denied) {
      expect(isCrewChildActionAllowed(action, role), `${role}:${action}`).toBe(false);
    }
  }
});

it("derives legacy worker markers as the worker role", () => {
  vi.stubEnv("PI_CREW_ROLE", undefined);
  vi.stubEnv("PI_CREW_WORKER", "1");
  expect(getCrewChildRole()).toBe("worker");

  vi.stubEnv("PI_CREW_WORKER", undefined);
  vi.stubEnv("PI_LOBBY_ID", "lobby-1");
  expect(getCrewChildRole()).toBe("worker");
});
```

Add a router-level test proving `join` passes the child authorization check before registration:

```ts
it("lets an unregistered worker reach the join handler", async () => {
  const { cwd } = createTempCrewDirs();
  const state = createTestState("CrewWorker");
  state.registered = false;
  const dirs = createDirs(cwd);
  vi.stubEnv("PI_CREW_ROLE", "worker");
  vi.stubEnv("PI_CREW_WORKER", "1");

  const response = await executeCrewAction(
    "join",
    {},
    state,
    dirs,
    createMockContext(cwd),
    () => {},
    () => {},
    vi.fn(),
  );

  expect(response.details.error).not.toBe("controller_only");
  expect(state.registered).toBe(true);
});
```

Keep the existing approval/rejection denial test.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/crew/router-status.test.ts
```

Expected: FAIL because `getCrewChildRole` is not exported, the policy has no role parameter, and `join`, `task.start`, and `task.block` are denied.

- [ ] **Step 3: Implement the minimal role-aware predicate**

Replace `crew/child-actions.ts` with:

```ts
export type CrewChildRole = "planner" | "reviewer" | "analyst" | "worker";

const CHILD_ROLES = new Set<CrewChildRole>([
  "planner", "reviewer", "analyst", "worker",
]);

const SHARED_CHILD_ACTIONS = new Set([
  "join", "status", "list", "whois", "feed", "set_status",
  "send", "broadcast", "task.show", "task.list", "task.ready",
  "crew.status", "crew.agents",
]);

const WORKER_ACTIONS = new Set([
  "reserve", "release", "task.start", "task.progress", "task.done", "task.block",
]);

export function getCrewChildRole(): CrewChildRole | undefined {
  const configured = process.env.PI_CREW_ROLE;
  if (configured && CHILD_ROLES.has(configured as CrewChildRole)) {
    return configured as CrewChildRole;
  }
  if (process.env.PI_CREW_WORKER === "1" || process.env.PI_LOBBY_ID) {
    return "worker";
  }
  return undefined;
}

export function isCrewChildActionAllowed(
  action: string,
  role: CrewChildRole | undefined = getCrewChildRole(),
): boolean {
  if (!role) return false;
  if (SHARED_CHILD_ACTIONS.has(action)) return true;
  return role === "worker" && WORKER_ACTIONS.has(action);
}
```

In `crew/index.ts`, pass the effective role explicitly at the existing guard:

```ts
import {
  getCrewChildRole,
  isCrewChildActionAllowed,
} from "./child-actions.ts";

const childRole = getCrewChildRole();
if (isCrewChildProcess() && !isCrewChildActionAllowed(action, childRole)) {
  return result(`Error: ${action} is controller-only.`, {
    mode: action,
    error: "controller_only",
  });
}
```

Do not move `join`; once the policy permits it, the existing pre-registration branch is correct.

- [ ] **Step 4: Run focused and related authorization tests**

Run:

```bash
npm test -- tests/crew/router-status.test.ts tests/crew/team-routing.test.ts tests/crew/team-task-approval.test.ts
```

Expected: PASS. Planner, reviewer, and analyst task mutations remain controller-only; worker protocol actions pass the authorization boundary.

- [ ] **Step 5: Commit the action-policy correction**

```bash
git add crew/child-actions.ts crew/index.ts tests/crew/router-status.test.ts
git commit -m "fix: restore role-aware Crew child actions"
```

---

### Task 2: Enforce ownership when a child blocks a task

**Files:**

- Modify: `crew/handlers/task.ts:588-623`
- Modify: `tests/crew/task-actions.test.ts:10-18,316-371`

**Interfaces:**

- Consumes: existing `canMutateAssignedTask(task, agentName, isChild): boolean` in `crew/handlers/task.ts`.
- Produces: `task.block` returns `{ error: "not_owner" }` for a child that does not own the selected task.
- Dependencies: none.

- [ ] **Step 1: Extend the task-test helper and add a failing ownership test**

Change the helper in `tests/crew/task-actions.test.ts` so it can call `block`:

```ts
async function callAs(
  cwd: string,
  agentName: string,
  op: "progress" | "done" | "block",
  id: string,
) {
  const params = op === "progress"
    ? { id, message: "Still working" }
    : op === "done"
      ? { id, summary: "Finished" }
      : { id, reason: "Waiting for input" };
  return taskHandler.execute(op, params, createState(agentName), createMockContext(cwd));
}
```

Add this case inside `describe("assigned task ownership")`:

```ts
it("allows only the assigned child to block an in-progress task", async () => {
  const { cwd } = createTempCrewDirs();
  store.createPlan(cwd, "docs/PRD.md");
  const task = store.createTask(cwd, "Task", "Desc");
  store.startTask(cwd, task.id, "WorkerA");
  vi.stubEnv("PI_CREW_ROLE", "worker");
  vi.stubEnv("PI_CREW_WORKER", "1");

  expect(await callAs(cwd, "WorkerB", "block", task.id)).toMatchObject({
    details: { error: "not_owner" },
  });
  expect(store.getTask(cwd, task.id)?.status).toBe("in_progress");

  expect(await callAs(cwd, "WorkerA", "block", task.id)).toMatchObject({
    details: { task: { status: "blocked" } },
  });
});
```

- [ ] **Step 2: Run the ownership test and verify RED**

Run:

```bash
npm test -- tests/crew/task-actions.test.ts -t "allows only the assigned child to block"
```

Expected: FAIL because `WorkerB` currently blocks `WorkerA`'s task.

- [ ] **Step 3: Add the same ownership guard used by progress and completion**

In `taskBlock()`, after validating `id` and `reason`, read and validate the task before calling `executeTaskAction`:

```ts
const task = store.getTask(cwd, id);
if (!task) {
  return result(`Error: Task ${id} not found`, {
    mode: "task.block", error: "not_found", id,
  });
}

if (!canMutateAssignedTask(task, state.agentName || "unknown", isCrewChildProcess())) {
  return result(`Error: ${task.id} is assigned to ${task.assigned_to ?? "another worker"}.`, {
    mode: "task.block",
    error: "not_owner",
    id: task.id,
  });
}
```

Leave controller recovery behavior unchanged because `canMutateAssignedTask` bypasses ownership for non-child processes.

- [ ] **Step 4: Run all task-action tests**

Run:

```bash
npm test -- tests/crew/task-actions.test.ts tests/crew/team-task-approval.test.ts
```

Expected: PASS, including existing progress, completion, controller recovery, strict dependency, and approval cases.

- [ ] **Step 5: Commit the ownership correction**

```bash
git add crew/handlers/task.ts tests/crew/task-actions.test.ts
git commit -m "fix: enforce task block ownership"
```

---

### Task 3: Restore live worker broadcasts

**Files:**

- Modify: `handlers.ts:398-413`
- Modify: `tests/crew/worker-coordination.test.ts:530-625`

**Interfaces:**

- Consumes: the existing ordinary broadcast loop in `executeSend()` and existing `getActiveAgents`, `validateTargetAgent`, `sendMessageToAgent`, message budget, and feed APIs.
- Produces: a worker broadcast returns the ordinary `{ sent: string[], failed: Array<{ name: string; error: string }> }` result and delivers one inbox message per active peer.
- Dependencies: none.

- [ ] **Step 1: Change the worker-broadcast regression test to require peer delivery**

Replace `worker broadcast logs to feed only` with:

```ts
it("worker broadcast delivers to every active peer and logs one feed event", () => {
  process.env.PI_CREW_WORKER = "1";
  process.env.PI_CREW_ROLE = "worker";

  const result = executeSend(
    state as any,
    messageDirs as any,
    dirs.cwd,
    undefined,
    true,
    "Worker update",
  );

  expect(result.details).toMatchObject({
    sent: ["OakBear", "PineFox"],
    failed: [],
  });
  expect(storeModule.sendMessageToAgent).toHaveBeenCalledTimes(2);
  expect(storeModule.sendMessageToAgent).toHaveBeenCalledWith(
    state,
    messageDirs,
    "OakBear",
    "Worker update",
    undefined,
  );
  expect(storeModule.sendMessageToAgent).toHaveBeenCalledWith(
    state,
    messageDirs,
    "PineFox",
    "Worker update",
    undefined,
  );
  expect(feedModule.logFeedEvent).toHaveBeenCalledTimes(1);
  expect(feedModule.logFeedEvent).toHaveBeenCalledWith(
    dirs.cwd,
    "EpicGrove",
    "message",
    undefined,
    "Worker update",
  );
});
```

Update the message-budget test's first-result assertions:

```ts
expect(first.content[0]?.text).toContain("Message sent to OakBear, PineFox");
expect(first.content[0]?.text).toContain("(0 messages remaining)");
expect(second.content[0]?.text).toContain("Message budget reached (1/1");
```

Update `afterEach` to delete both worker variables:

```ts
delete process.env.PI_CREW_WORKER;
delete process.env.PI_CREW_ROLE;
```

- [ ] **Step 2: Run the broadcast tests and verify RED**

Run:

```bash
npm test -- tests/crew/worker-coordination.test.ts -t "worker broadcast"
```

Expected: FAIL because the worker-only branch reports `sent: ["feed"]` and does not call `sendMessageToAgent`.

- [ ] **Step 3: Remove only the worker feed-only shortcut**

Delete this branch from `handlers.ts`:

```ts
if (process.env.PI_CREW_WORKER) {
  messagesSentThisSession++;
  const preview = message.length > 200 ? message.slice(0, 197) + "..." : message;
  logFeedEvent(cwd, state.agentName, "message", undefined, preview);
  const remaining = budget - messagesSentThisSession;
  return result(
    `Broadcast logged. (${remaining} message${remaining === 1 ? "" : "s"} remaining)`,
    { mode: "send", sent: ["feed"], failed: [] },
  );
}
```

Do not change the ordinary recipient resolution, validation, inbox writing, partial-failure reporting, budget increment, or feed logging below it.

- [ ] **Step 4: Run the complete worker-coordination test file**

Run:

```bash
npm test -- tests/crew/worker-coordination.test.ts
```

Expected: PASS. Worker and non-worker broadcasts share one delivery path, direct messages still work, and budgets still stop excess sends.

- [ ] **Step 5: Commit the broadcast restoration**

```bash
git add handlers.ts tests/crew/worker-coordination.test.ts
git commit -m "fix: deliver worker broadcasts to active peers"
```

---

### Task 4: Show message-send errors while preserving composer input

**Files:**

- Create: `tests/overlay-message-input.test.ts`
- Modify: `overlay-render.ts:433-461`

**Interfaces:**

- Consumes: `CrewViewState.notification`, `CrewViewState.messageInput`, `handleMessageInput()`, and existing `renderMessageBar()`.
- Produces: `renderLegend()` includes an unexpired notification and the current composer text when `inputMode === "message"`.
- Dependencies: none.

- [ ] **Step 1: Create a failing message-submission rendering test**

Create `tests/overlay-message-input.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../lib.ts";
import type { TUI } from "@earendil-works/pi-tui";

vi.mock("../store.ts", () => ({
  getActiveAgents: () => [],
  sendMessageToAgent: vi.fn(),
  validateTargetAgent: () => ({ valid: false, error: "not_found" }),
}));

vi.mock("../feed.ts", () => ({
  logFeedEvent: vi.fn(),
  readFeedEvents: () => [],
}));

vi.mock("../crew/live-progress.ts", () => ({
  getLiveWorkers: () => new Map(),
  hasLiveWorkers: () => false,
  onLiveWorkersChanged: () => () => {},
}));

vi.mock("../crew/registry.ts", () => ({
  hasActiveWorker: () => false,
  getActiveWorkers: () => [],
}));

import {
  createCrewViewState,
  handleMessageInput,
} from "../overlay-actions.ts";
import { renderLegend } from "../overlay-render.ts";

const theme = { fg: (_color: string, text: string) => text } as any;
const state = { agentName: "Lead", scopeToFolder: false } as MessengerState;
const dirs = { base: "/tmp", registry: "/tmp/reg", inbox: "/tmp/inbox" } as Dirs;

function makeTui(): TUI {
  return { requestRender: vi.fn() } as unknown as TUI;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("overlay message submission feedback", () => {
  it("shows a malformed direct-message error without discarding input", () => {
    vi.useFakeTimers();
    const viewState = createCrewViewState();
    viewState.inputMode = "message";
    viewState.messageInput = "@missing";

    handleMessageInput("\r", viewState, state, dirs, "/tmp/project", makeTui());
    const legend = renderLegend(theme, "/tmp/project", 160, viewState, null);

    expect(legend).toContain("Use @name <message>");
    expect(legend).toContain("@missing");
    expect(viewState.inputMode).toBe("message");
    expect(viewState.messageInput).toBe("@missing");
  });

  it("shows a broadcast delivery error without discarding input", () => {
    vi.useFakeTimers();
    const viewState = createCrewViewState();
    viewState.inputMode = "message";
    viewState.messageInput = "status update";

    handleMessageInput("\r", viewState, state, dirs, "/tmp/project", makeTui());
    const legend = renderLegend(theme, "/tmp/project", 160, viewState, null);

    expect(legend).toContain("No peers available for @all");
    expect(legend).toContain("status update");
    expect(viewState.messageInput).toBe("status update");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/overlay-message-input.test.ts
```

Expected: FAIL because `renderLegend()` returns the composer before checking `viewState.notification`.

- [ ] **Step 3: Render active notification text beside the message composer**

In `renderLegend()`, replace the current message-mode branch with:

```ts
if (viewState.inputMode === "message") {
  const composer = renderMessageBar(viewState.messageInput);
  const activeNotification = viewState.notification
    && Date.now() < viewState.notification.expiresAt
    ? viewState.notification.message
    : null;
  if (viewState.notification && !activeNotification) {
    viewState.notification = null;
  }
  const text = activeNotification
    ? `${activeNotification}  ${composer}`
    : composer;
  return truncateToWidth(theme.fg("accent", text + "  [^T] [^B]"), width);
}
```

Do not reset `messageInput` on failure; existing send helpers already reset only after success.

- [ ] **Step 4: Run message, autocomplete, and overlay tests**

Run:

```bash
npm test -- tests/overlay-message-input.test.ts tests/mention-autocomplete.test.ts tests/overlay.test.ts
```

Expected: PASS. Enter errors are visible, input is preserved, mention completion still works, and ordinary overlay behavior is unchanged.

- [ ] **Step 5: Commit the overlay feedback correction**

```bash
git add overlay-render.ts tests/overlay-message-input.test.ts
git commit -m "fix: show overlay message send errors"
```

---

## Final Verification

After all four task commits are present, run:

```bash
npm test -- \
  tests/crew/router-status.test.ts \
  tests/crew/team-routing.test.ts \
  tests/crew/team-task-approval.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/worker-coordination.test.ts \
  tests/overlay-message-input.test.ts \
  tests/mention-autocomplete.test.ts \
  tests/overlay.test.ts
npx tsc --noEmit
git diff --check HEAD~4..HEAD
```

Then run the complete suite:

```bash
npm test
```

Expected: all tests and TypeScript checks pass with no controller-boundary, task-ownership, messaging, or overlay regressions.

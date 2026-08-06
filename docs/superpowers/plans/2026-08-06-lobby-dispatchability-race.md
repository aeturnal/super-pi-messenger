# Lobby Dispatchability Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Crew from assigning tasks to lobby workers that are already stopping or signal-terminated.

**Architecture:** Keep the existing worker registry. Add the missing child-process state checks directly to the lobby availability predicate, with focused registry tests.

**Tech Stack:** TypeScript, Node.js `ChildProcess`, Vitest.

## Global Constraints

- Keep the production change inside `crew/registry.ts`.
- Do not add lifecycle state, timers, leases, heartbeats, or new modules.
- Preserve healthy lobby reuse, assignment rules, compatibility, and concurrency behavior.

---

### Task 1: Strengthen lobby worker availability

**Files:**
- Modify: `tests/crew/registry.test.ts`
- Modify: `crew/registry.ts:108-118`

**Interfaces:**
- Consumes: existing `registerWorker`, `unregisterWorker`, and `getAvailableLobbyWorkers` exports.
- Produces: unchanged `getAvailableLobbyWorkers(cwd: string): LobbyWorkerEntry[]` behavior with stricter process-state filtering.

- [ ] **Step 1: Add the failing registry tests**

Import `getAvailableLobbyWorkers`, then register lobby fixtures covering healthy, kill-requested, signal-terminated, exited, and assigned states.

```ts
import {
  getAvailableLobbyWorkers,
  hasActiveWorker,
  registerWorker,
  unregisterWorker,
} from "../../crew/registry.ts";

it.each([
  ["healthy", { exitCode: null, signalCode: null, killed: false }, null, true],
  ["kill requested", { exitCode: null, signalCode: null, killed: true }, null, false],
  ["signal terminated", { exitCode: null, signalCode: "SIGTERM", killed: true }, null, false],
  ["exited", { exitCode: 1, signalCode: null, killed: true }, null, false],
  ["assigned", { exitCode: null, signalCode: null, killed: false }, "task-2", false],
])("filters %s lobby workers", (_label, processState, assignedTaskId, expected) => {
  const { cwd } = createTempCrewDirs();
  const taskId = "__lobby-test";
  const proc = processState as ChildProcess;

  registerWorker({
    type: "lobby",
    cwd,
    taskId,
    name: "LobbyWorker",
    proc,
    lobbyId: "test",
    assignedTaskId,
    managedByWork: false,
    coordination: "chatty",
    startedAt: 0,
    promptTmpDir: null,
    aliveFile: null,
    superpowersActive: false,
    completion: Promise.resolve({} as never),
    resolveCompletion: () => {},
  });

  try {
    expect(getAvailableLobbyWorkers(cwd).length > 0).toBe(expected);
  } finally {
    unregisterWorker(cwd, taskId);
  }
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npx vitest run tests/crew/registry.test.ts
```

Expected: the `kill requested` and `signal terminated` cases fail because the current predicate checks only `exitCode`.

- [ ] **Step 3: Make the minimal production change**

In `getAvailableLobbyWorkers`, replace the current process check with:

```ts
if (entry.proc.exitCode !== null || entry.proc.signalCode !== null || entry.proc.killed) continue;
```

Do not change other registry behavior.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npx vitest run tests/crew/registry.test.ts
npx vitest run tests/crew/lobby.test.ts tests/crew/team-work.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npx tsc --noEmit
npm test
```

Then run LSP and pi-lens diagnostics for:

- `crew/registry.ts`
- `tests/crew/registry.test.ts`

Expected: TypeScript passes, all tests pass, and no blocking diagnostics remain.

- [ ] **Step 6: Commit the fix**

```bash
git add crew/registry.ts tests/crew/registry.test.ts
git commit -m "fix: reject stopping lobby workers"
```

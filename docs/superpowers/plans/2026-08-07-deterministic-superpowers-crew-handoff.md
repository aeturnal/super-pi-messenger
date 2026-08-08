# Deterministic Superpowers-to-Crew Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass the exact Superpowers implementation plan and linked-worktree identity into Crew, then keep every Crew child in that worktree.

**Architecture:** Add one small workspace module for Git identity, path containment, and child guidance. Store its identity on workspace-backed plans, verify it before controller actions and child launches, and expose the canonical root through `cwd`, an environment variable, and a short system-prompt rule. Existing Crew flows remain unchanged when no `workspace` is supplied.

**Tech Stack:** TypeScript, Node.js `fs/path/child_process`, Git CLI, TypeBox, Vitest

## Global Constraints

- Keep `prd` as the only plan-source field.
- Add only one public input: optional `workspace` on the `plan` action.
- Crew must never create, enter, switch, or remove a worktree.
- Workspace hardening applies only when `workspace` was explicitly supplied.
- Reject the main checkout, submodules, mismatched linked worktrees, and plan files outside the worktree.
- Do not modify stock Superpowers skill files.
- Do not change task parsing, scheduling, or review rules.

---

### Task 1: Resolve and verify linked-worktree identity

**Files:**

- Create: `crew/workspace.ts`
- Create: `tests/helpers/git-worktree.ts`
- Create: `tests/crew/workspace-identity.test.ts`
- Modify: `crew/types.ts:15-22`

**Interfaces:**

- Produces: `WorkspaceIdentity { root: string; gitDir: string; gitCommonDir: string }`
- Produces: `WorkspaceError` with `code`, `expected?`, and `observed?`
- Produces: `resolveWorkspace(workspace: string, cwd: string): WorkspaceIdentity`
- Produces: `verifyWorkspace(expected: WorkspaceIdentity, cwd: string): WorkspaceIdentity`

- [ ] **Step 1: Write the Git-worktree fixture**

Create `tests/helpers/git-worktree.ts`:

```ts
export interface GitWorktreeFixture {
  main: string;
  worktree: string;
  otherWorktree: string;
  cleanup(): void;
}

export function createGitWorktreeFixture(): GitWorktreeFixture;
```

The helper must create one temporary Git repository, one commit, and two detached linked worktrees using `execFileSync("git", ...)`. Configure `user.name` and `user.email` locally. Keep every path under one temporary root so `cleanup()` is one recursive removal.

- [ ] **Step 2: Write failing identity tests**

Create `tests/crew/workspace-identity.test.ts` covering:

```ts
it("resolves and re-verifies one linked worktree", () => {
  const fx = createGitWorktreeFixture();
  const identity = resolveWorkspace(fx.worktree, fx.worktree);
  expect(identity.root).toBe(fs.realpathSync(fx.worktree));
  expect(verifyWorkspace(identity, fx.worktree)).toEqual(identity);
  fx.cleanup();
});

it("rejects the main checkout", () => {
  const fx = createGitWorktreeFixture();
  expect(() => resolveWorkspace(fx.main, fx.main)).toThrow();
  fx.cleanup();
});

it("rejects another worktree from the same repository", () => {
  const fx = createGitWorktreeFixture();
  const identity = resolveWorkspace(fx.worktree, fx.worktree);
  expect(() => verifyWorkspace(identity, fx.otherWorktree)).toThrow();
  fx.cleanup();
});
```

Also assert stable error codes for non-absolute input, non-Git input, mismatched `cwd`, the main checkout, and a real submodule fixture.

- [ ] **Step 3: Run the tests to verify RED**

```bash
npm test -- tests/crew/workspace-identity.test.ts
```

Expected: FAIL because `crew/workspace.ts` does not exist.

- [ ] **Step 4: Add the identity type and implementation**

Add to `crew/types.ts`:

```ts
export interface WorkspaceIdentity {
  root: string;
  gitDir: string;
  gitCommonDir: string;
}
```

In `crew/workspace.ts`, run these private Git queries:

```text
git -C <root> rev-parse --show-toplevel
git -C <root> rev-parse --absolute-git-dir
git -C <root> rev-parse --path-format=absolute --git-common-dir
git -C <root> rev-parse --show-superproject-working-tree
```

Require an absolute input. Canonicalize paths with `realpathSync`. Reject a non-empty superproject path as `workspace_submodule`, reject `gitDir === gitCommonDir` as `workspace_not_linked`, and require canonical workspace, canonical `cwd`, and Git top-level to match. `verifyWorkspace` must resolve the observed identity again and compare all three fields.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/crew/workspace-identity.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on the four files, then commit:

```bash
git add crew/workspace.ts crew/types.ts tests/helpers/git-worktree.ts tests/crew/workspace-identity.test.ts
git commit -m "feat: resolve linked worktree identity"
```

---

### Task 2: Add plan containment and child workspace guidance

**Files:**

- Modify: `crew/workspace.ts`
- Create: `tests/crew/workspace-containment.test.ts`

**Interfaces:**

- Consumes: Task 1 `WorkspaceIdentity`
- Produces: `resolveContainedFile(workspace: WorkspaceIdentity, filePath: string): string`
- Produces: `workspacePrompt(identity: WorkspaceIdentity): string`

- [ ] **Step 1: Write failing containment tests**

Create `tests/crew/workspace-containment.test.ts` using the Task 1 fixture. Cover:

- a normal file inside the worktree is accepted and returned canonically;
- a file in the main checkout is rejected with `plan_outside_workspace`;
- `../` traversal outside the worktree is rejected;
- a symlink inside the worktree pointing outside is rejected;
- a symlink alias of the worktree itself is accepted after canonicalization;
- `workspacePrompt()` contains the exact root, `PI_CREW_WORKSPACE_ROOT`, `git rev-parse --show-toplevel`, and a stop/block instruction.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/workspace-containment.test.ts
```

Expected: FAIL because the two functions are absent.

- [ ] **Step 3: Implement the two focused functions**

`resolveContainedFile()` must call `realpathSync` on the file and accept it only when `path.relative(identity.root, file)` is neither absolute nor `..`/`../...`.

`workspacePrompt()` must return one short system-prompt section. It must name the authoritative root, forbid edits outside it, require checking `git rev-parse --show-toplevel` before the first edit, and require blocking when the observed root differs from `PI_CREW_WORKSPACE_ROOT`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/crew/workspace-identity.test.ts tests/crew/workspace-containment.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on both files, then commit:

```bash
git add crew/workspace.ts tests/crew/workspace-containment.test.ts
git commit -m "feat: contain plans within Crew worktrees"
```

---

### Task 3: Add the workspace API and plan persistence

**Files:**

- Modify: `crew/types.ts:15-22,87-145`
- Modify: `crew/store.ts:84-98`
- Modify: `index.ts:405-520`
- Create: `tests/crew/workspace-plan-store.test.ts`

**Interfaces:**

- Consumes: `WorkspaceIdentity`
- Produces: `CrewParams.workspace?: string`
- Produces: `Plan.workspace?: WorkspaceIdentity`
- Changes: `createPlan(cwd, prdPath, prompt?, workspace?)`

- [ ] **Step 1: Write failing persistence tests**

Create `tests/crew/workspace-plan-store.test.ts` and assert:

```ts
const plan = store.createPlan(cwd, "docs/plan.md", undefined, identity);
expect(plan.workspace).toEqual(identity);
expect(store.getPlan(cwd)?.workspace).toEqual(identity);
```

Also assert that the existing three-argument call stores no `workspace` and remains unchanged.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/workspace-plan-store.test.ts
```

Expected: FAIL because `Plan` and `createPlan` do not accept the identity.

- [ ] **Step 3: Add the minimal type, store, and schema changes**

Add:

```ts
export interface Plan {
  prd: string;
  prompt?: string;
  workspace?: WorkspaceIdentity;
  // existing fields unchanged
}

export interface CrewParams {
  prd?: string;
  workspace?: string;
  // existing fields unchanged
}
```

Change the store signature without breaking current callers:

```ts
export function createPlan(
  cwd: string,
  prdPath: string,
  prompt?: string,
  workspace?: WorkspaceIdentity,
): Plan;
```

Conditionally add `workspace` to `plan.json`. Add optional `workspace` to the TypeBox schema in `index.ts` with description `Absolute linked-worktree path for a Superpowers plan handoff`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/crew/workspace-plan-store.test.ts tests/crew/plan-replan.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on the four files, then commit:

```bash
git add crew/types.ts crew/store.ts index.ts tests/crew/workspace-plan-store.test.ts
git commit -m "feat: store Crew plan workspace identity"
```

---

### Task 4: Validate exact plan and workspace during planning

**Files:**

- Modify: `crew/handlers/plan.ts:203-563`
- Create: `tests/crew/plan-workspace.test.ts`

**Interfaces:**

- Consumes: Tasks 1-3 workspace functions and persisted identity
- Produces: deterministic plan intake for `{ prd, workspace }`
- Preserves: existing plan behavior when `workspace` is absent

- [ ] **Step 1: Write failing planning tests**

Create `tests/crew/plan-workspace.test.ts` using `createGitWorktreeFixture()` and the mocked `spawnAgents` pattern from `tests/crew/plan-replan.test.ts`.

For the successful case:

```ts
await planHandler.execute(
  {
    action: "plan",
    prd: "docs/superpowers/plans/example.md",
    workspace: fx.worktree,
    autoWork: false,
  },
  { cwd: fx.worktree, hasUI: false, ui: {} } as any,
  "agent",
);
```

Assert that:

- `plan.json` contains the canonical identity;
- the planner prompt contains the exact relative source path and distinctive plan content;
- `spawnAgents` receives the canonical worktree as its `cwd` argument.

Also cover these failures with no planner launch or task creation:

- `workspace` without explicit `prd` → `workspace_requires_prd`;
- missing workspace → `workspace_invalid`;
- main checkout → `workspace_not_linked`;
- plan outside workspace → `plan_outside_workspace`.

Keep one regression case showing a plan without `workspace` still works.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/plan-workspace.test.ts
```

Expected: new workspace cases fail.

- [ ] **Step 3: Add plan-handler validation**

In `crew/handlers/plan.ts`:

1. Reject `params.workspace` without `params.prd`.
2. Resolve the workspace before reading the PRD.
3. Resolve the PRD through `resolveContainedFile()` when workspace-backed.
4. Read the canonical file while retaining the caller's exact `prd` string as the source label.
5. Call `store.createPlan(cwd, prdPath, prompt, workspaceIdentity)`.
6. Pass `workspaceIdentity.root` to `spawnAgents`; otherwise keep using `ctx.cwd`.
7. Convert `WorkspaceError` to a result with its stable code and expected/observed paths.
8. Never fall back to discovery after an explicit workspace failure.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/crew/plan-workspace.test.ts tests/crew/plan-replan.test.ts tests/crew/plan-skills.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on the handler and test, then commit:

```bash
git add crew/handlers/plan.ts tests/crew/plan-workspace.test.ts
git commit -m "feat: validate Superpowers plan handoff"
```

---

### Task 5: Enforce workspace identity for common child launches

**Files:**

- Modify: `crew/workspace.ts`
- Modify: `crew/agents.ts:45-209,211-482`
- Modify: `crew/index.ts:39-272`
- Create: `tests/crew/workspace-launch.test.ts`

**Interfaces:**

- Produces: `verifyPlanWorkspace(cwd: string): WorkspaceIdentity | null`
- Produces: `PI_CREW_WORKSPACE_ROOT` and workspace guidance for fresh Crew children
- Preserves: ordinary child behavior when the plan has no workspace

- [ ] **Step 1: Write failing child-launch tests**

Create `tests/crew/workspace-launch.test.ts` using the spawn capture pattern from `tests/crew/superpowers-launch.test.ts`.

For planner, worker, reviewer, and analyst roles, assert:

```ts
expect(capture.options.cwd).toBe(identity.root);
expect(capture.options.env.PI_CREW_WORKSPACE_ROOT).toBe(identity.root);
expect(fs.readFileSync(systemPromptPath, "utf8")).toContain(identity.root);
expect(fs.readFileSync(systemPromptPath, "utf8"))
  .toContain("git rev-parse --show-toplevel");
```

Also assert:

- a stored identity changed to the other worktree rejects before `spawn()`;
- a plan without workspace keeps existing launch behavior;
- `executeCrewAction("work", ...)` returns `workspace_mismatch` and leaves a ready task `todo` when identity verification fails.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/workspace-launch.test.ts
```

Expected: new cases fail.

- [ ] **Step 3: Add the shared stored-plan verifier**

Add to `crew/workspace.ts`:

```ts
export function verifyPlanWorkspace(cwd: string): WorkspaceIdentity | null;
```

This is the only store-aware workspace helper. It returns `null` when the plan has no identity and otherwise calls `verifyWorkspace()`.

- [ ] **Step 4: Harden `spawnAgents`**

At the start of `spawnAgents`:

```ts
const workspace = verifyPlanWorkspace(cwd);
const launchCwd = workspace?.root ?? cwd;
```

Pass both values into `runAgent`. For workspace-backed launches:

- force creation of the temporary system-prompt file and append `workspacePrompt()`;
- set `PI_CREW_WORKSPACE_ROOT`;
- spawn with `cwd: launchCwd`.

Do nothing new when `workspace` is `null`. This boundary covers planners, workers, reviewers, revision planners, and plan-sync analysts because they already use `spawnAgents`.

- [ ] **Step 5: Add controller preflight**

In `crew/index.ts`, call `verifyPlanWorkspace(ctx.cwd)` before routing:

```text
work
review
sync
task.revise
task.revise-tree
```

Return the stable workspace error without entering the handler. Do not guard read-only actions, `work.stop`, or `plan.cancel`. Keep the `spawnAgents` check as defense in depth.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/crew/workspace-launch.test.ts tests/crew/superpowers-launch.test.ts tests/crew/agent-events.test.ts tests/crew/plan-replan.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on the four files, then commit:

```bash
git add crew/workspace.ts crew/agents.ts crew/index.ts tests/crew/workspace-launch.test.ts
git commit -m "feat: enforce workspace on Crew child launches"
```

---

### Task 6: Bind lobby workers to the plan workspace

**Files:**

- Modify: `crew/registry.ts:13-38`
- Modify: `crew/lobby.ts:63-290,304-436`
- Modify: `crew/handlers/work.ts:228-262`
- Modify: `tests/crew/lobby.test.ts`

**Interfaces:**

- Consumes: `verifyPlanWorkspace()` and `workspacePrompt()`
- Produces: `LobbyWorkerEntry.workspace?: WorkspaceIdentity`
- Produces: `LobbyCompatibility.workspace?: WorkspaceIdentity`

- [ ] **Step 1: Add failing lobby tests**

Extend `tests/crew/lobby.test.ts` to prove:

1. A workspace-backed lobby starts with canonical `cwd`, `PI_CREW_WORKSPACE_ROOT`, and workspace guidance.
2. Identical workspace identities are compatible.
3. A worker with no identity is incompatible with a workspace-backed task.
4. A worker from another linked worktree is incompatible.
5. `spawnWorkerForTask` verifies workspace identity before changing a task from `todo`.

- [ ] **Step 2: Run the lobby test to verify RED**

```bash
npm test -- tests/crew/lobby.test.ts
```

Expected: new cases fail.

- [ ] **Step 3: Store, compare, and enforce lobby identity**

Add optional workspace identity to `LobbyWorkerEntry` and `LobbyCompatibility`. Compare `root`, `gitDir`, and `gitCommonDir`; two absent identities remain compatible.

In `spawnLobbyWorker`, verify the plan workspace, use its root as `cwd`, add the environment variable and guidance, and store the identity on the worker.

In `crew/handlers/work.ts`, include `plan.workspace` in each lobby requirement. In `assignTaskToLobbyWorker` and `spawnWorkerForTask`, verify the current plan and worker identities before changing assignment, task, or alive-file state.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/crew/lobby.test.ts tests/crew/team-work.test.ts tests/crew/work-stop.test.ts tests/crew/graceful-shutdown.test.ts
npx tsc --noEmit
```

Run LSP diagnostics on the four files, then commit:

```bash
git add crew/registry.ts crew/lobby.ts crew/handlers/work.ts tests/crew/lobby.test.ts
git commit -m "feat: bind lobby workers to plan worktrees"
```

---

### Task 7: Document and enforce the Superpowers handoff contract

**Files:**

- Modify: `crew/superpowers-policy.ts:5-12`
- Modify: `tests/crew/superpowers-policy.test.ts:72-122`
- Modify: `index.ts:405-520`
- Modify: `skills/pi-messenger-crew/SKILL.md`

**Interfaces:**

- Consumes: `plan` with exact `prd` and `workspace`
- Produces: controlling-agent instructions that preserve both paths

- [ ] **Step 1: Strengthen the failing policy test**

Add these assertions to the active-policy test:

```ts
expect(result).toContain('prd: "<exact implementation-plan path>"');
expect(result).toContain('workspace: "<absolute linked-worktree path>"');
expect(result).toContain("Do not use bare plan auto-discovery");
expect(result).toContain("Do not replace the implementation plan with a summary");
expect(result).toContain("enter the linked worktree before starting Crew planning");
```

Keep inactive-state, child-marker, and idempotency tests unchanged.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: FAIL because the explicit handoff contract is absent.

- [ ] **Step 3: Update the packaged policy**

Add this short contract to `OUTER_POLICY`:

```text
When writing-plans produced an implementation plan, enter the linked worktree before starting Crew planning. Pass the exact paths with pi_messenger({ action: "plan", prd: "<exact implementation-plan path>", workspace: "<absolute linked-worktree path>" }). Do not use bare plan auto-discovery and do not replace the implementation plan with a summary. Crew verifies the worktree but does not create or switch it.
```

Do not modify stock Superpowers files.

- [ ] **Step 4: Update public help**

Add this example to the tool description in `index.ts` and to `skills/pi-messenger-crew/SKILL.md`:

```ts
pi_messenger({
  action: "plan",
  prd: "docs/superpowers/plans/feature.md",
  workspace: "/absolute/worktree"
})
```

State that Superpowers handoffs pass both exact paths and Crew verifies but never manages the worktree.

- [ ] **Step 5: Run full verification**

```bash
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/plan-workspace.test.ts tests/crew/workspace-launch.test.ts tests/crew/lobby.test.ts
npm test
npx tsc --noEmit
```

Run `lens_diagnostics` in `all` mode and resolve every blocking error in edited files.

- [ ] **Step 6: Commit Task 7**

```bash
git add crew/superpowers-policy.ts tests/crew/superpowers-policy.test.ts index.ts skills/pi-messenger-crew/SKILL.md
git commit -m "docs: require exact Superpowers Crew handoff"
```

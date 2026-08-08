# Deterministic Superpowers-to-Crew Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass the exact Superpowers implementation plan and linked-worktree identity into Crew, then keep every Crew child in that worktree.

**Architecture:** Add one small workspace module that owns Git identity and containment checks. Store its identity on workspace-backed Crew plans, verify it at controller and child-launch boundaries, and give children the canonical root through `cwd`, an environment variable, and a short system-prompt rule. Existing Crew flows remain unchanged when no `workspace` is supplied.

**Tech Stack:** TypeScript, Node.js `fs/path/child_process`, Git CLI, TypeBox, Vitest

## Global Constraints

- Keep the existing `prd` field as the only plan-source field.
- Add only one new public input: optional `workspace` on the `plan` action.
- Crew must never create, enter, switch, or remove a worktree.
- Workspace hardening applies only when `workspace` was explicitly supplied.
- Reject the main checkout, submodules, mismatched linked worktrees, and plan files outside the worktree.
- Do not modify stock Superpowers skill files.
- Do not change task parsing, scheduling, or review rules.

---

### Task 1: Add the workspace identity module

**Files:**

- Create: `crew/workspace.ts`
- Create: `tests/helpers/git-worktree.ts`
- Create: `tests/crew/workspace.test.ts`
- Modify: `crew/types.ts:15-22`

**Interfaces:**

- Produces: `WorkspaceIdentity { root: string; gitDir: string; gitCommonDir: string }`
- Produces: `WorkspaceError` with stable `code`, `expected?`, and `observed?` fields
- Produces: `resolveWorkspace(workspace: string, cwd: string): WorkspaceIdentity`
- Produces: `verifyWorkspace(expected: WorkspaceIdentity, cwd: string): WorkspaceIdentity`
- Produces: `resolveContainedFile(workspace: WorkspaceIdentity, filePath: string): string`
- Produces: `workspacePrompt(identity: WorkspaceIdentity): string`

- [ ] **Step 1: Write a temporary Git-worktree test helper**

Create `tests/helpers/git-worktree.ts` with a helper that initializes a temporary repository, configures a local test identity, makes one commit, creates two detached linked worktrees, and removes the whole fixture in `cleanup()`:

```ts
export interface GitWorktreeFixture {
  main: string;
  worktree: string;
  otherWorktree: string;
  cleanup(): void;
}

export function createGitWorktreeFixture(): GitWorktreeFixture;
```

Use `execFileSync("git", args, { cwd, stdio: "pipe" })`. Create the linked worktrees with `git worktree add --detach <path> HEAD`. Keep all fixture directories under one `fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-worktree-"))` root so cleanup is one recursive removal.

- [ ] **Step 2: Write failing workspace tests**

Create `tests/crew/workspace.test.ts` covering these exact behaviors:

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
  expect(() => resolveWorkspace(fx.main, fx.main))
    .toThrowError(expect.objectContaining({ code: "workspace_not_linked" }));
  fx.cleanup();
});

it("rejects a different worktree of the same repository", () => {
  const fx = createGitWorktreeFixture();
  const identity = resolveWorkspace(fx.worktree, fx.worktree);
  expect(() => verifyWorkspace(identity, fx.otherWorktree))
    .toThrowError(expect.objectContaining({ code: "workspace_mismatch" }));
  fx.cleanup();
});

it("rejects a file outside the worktree", () => {
  const fx = createGitWorktreeFixture();
  const identity = resolveWorkspace(fx.worktree, fx.worktree);
  expect(() => resolveContainedFile(identity, path.join(fx.main, "README.md")))
    .toThrowError(expect.objectContaining({ code: "plan_outside_workspace" }));
  fx.cleanup();
});
```

Also cover: non-absolute workspace input, non-Git directory, `cwd` mismatch, a symlink alias that canonicalizes to the same worktree, a plan symlink escaping the worktree, and a real submodule fixture rejected with `workspace_submodule`.

- [ ] **Step 3: Run the tests to verify RED**

Run:

```bash
npm test -- tests/crew/workspace.test.ts
```

Expected: FAIL because `crew/workspace.ts` and its exports do not exist.

- [ ] **Step 4: Add the workspace type**

Add to `crew/types.ts` and reference it from `Plan` in the next task:

```ts
export interface WorkspaceIdentity {
  root: string;
  gitDir: string;
  gitCommonDir: string;
}
```

- [ ] **Step 5: Implement the workspace module**

Create `crew/workspace.ts`. Keep Git command execution private. Use:

```ts
git -C <root> rev-parse --show-toplevel
git -C <root> rev-parse --absolute-git-dir
git -C <root> rev-parse --path-format=absolute --git-common-dir
git -C <root> rev-parse --show-superproject-working-tree
```

Implementation rules:

- Require `path.isAbsolute(workspace)`.
- Canonicalize supplied paths with `fs.realpathSync`.
- Require canonical `cwd`, canonical supplied workspace, and Git top-level to match.
- Reject a non-empty superproject path as `workspace_submodule`.
- Reject `gitDir === gitCommonDir` as `workspace_not_linked`.
- In `verifyWorkspace`, resolve the observed identity again and compare all three stored fields.
- In `resolveContainedFile`, resolve the actual file with `realpathSync`, then accept it only when `path.relative(root, file)` is neither absolute nor `..`/`../...`.
- Make `workspacePrompt()` return a short section containing the exact root, `PI_CREW_WORKSPACE_ROOT`, the `git rev-parse --show-toplevel` pre-edit check, and a stop/block instruction for mismatches.

- [ ] **Step 6: Run focused tests and diagnostics**

Run:

```bash
npm test -- tests/crew/workspace.test.ts
```

Then run TypeScript/LSP diagnostics on:

```text
crew/workspace.ts
crew/types.ts
tests/helpers/git-worktree.ts
tests/crew/workspace.test.ts
```

Expected: tests pass and no TypeScript errors.

- [ ] **Step 7: Commit Task 1**

```bash
git add crew/workspace.ts crew/types.ts tests/helpers/git-worktree.ts tests/crew/workspace.test.ts
git commit -m "feat: add linked worktree identity checks"
```

---

### Task 2: Accept and persist the explicit plan workspace

**Files:**

- Modify: `crew/types.ts:15-22,87-145`
- Modify: `crew/store.ts:84-98`
- Modify: `index.ts:405-520`
- Modify: `crew/handlers/plan.ts:203-563`
- Create: `tests/crew/plan-workspace.test.ts`

**Interfaces:**

- Consumes: Task 1 workspace functions and `WorkspaceIdentity`
- Produces: `CrewParams.workspace?: string`
- Produces: `Plan.workspace?: WorkspaceIdentity`
- Changes: `createPlan(cwd, prdPath, prompt?, workspace?)`

- [ ] **Step 1: Write failing plan-workspace tests**

Create `tests/crew/plan-workspace.test.ts` using `createGitWorktreeFixture()` and the existing mocked `spawnAgents` pattern from `tests/crew/plan-replan.test.ts`.

Cover:

1. A plan call with exact `prd` and `workspace` stores the canonical identity.
2. The captured planner task contains the distinctive plan text and exact relative source path.
3. The planner launch receives the canonical worktree as its `cwd` argument.
4. A missing workspace directory returns `workspace_invalid` and launches no planner.
5. The main checkout returns `workspace_not_linked` and launches no planner.
6. A plan outside the worktree returns `plan_outside_workspace` and launches no planner.
7. `workspace` without explicit `prd` returns `workspace_requires_prd`.
8. Existing plan calls without `workspace` still work unchanged.

Use this successful call shape:

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

- [ ] **Step 2: Run the focused test to verify RED**

```bash
npm test -- tests/crew/plan-workspace.test.ts
```

Expected: FAIL because `workspace` is not accepted or persisted.

- [ ] **Step 3: Add the API and persistence fields**

Make these minimal type changes:

```ts
export interface Plan {
  prd: string;
  prompt?: string;
  workspace?: WorkspaceIdentity;
  // existing fields unchanged
}

export interface CrewParams {
  // existing plan fields
  prd?: string;
  workspace?: string;
}
```

Update `store.createPlan` to accept and conditionally persist `workspace` without changing existing callers:

```ts
export function createPlan(
  cwd: string,
  prdPath: string,
  prompt?: string,
  workspace?: WorkspaceIdentity,
): Plan;
```

Add optional `workspace` to the TypeBox schema in `index.ts` with description: `Absolute linked-worktree path for a Superpowers plan handoff`.

- [ ] **Step 4: Validate workspace and plan containment before plan creation**

In `crew/handlers/plan.ts`:

- If `params.workspace` exists without `params.prd`, return `workspace_requires_prd`.
- Resolve the workspace before reading the PRD.
- Resolve the explicit PRD through `resolveContainedFile()` when workspace-backed.
- Read from the returned canonical file path, while retaining the caller's exact `prd` string as the plan source label.
- Call `store.createPlan(cwd, prdPath, prompt, workspaceIdentity)`.
- Pass `workspaceIdentity.root` to `spawnAgents` for the planner; this equals verified `ctx.cwd` but makes the intended root explicit.
- Convert `WorkspaceError` into a result whose `details.error` is its stable code and whose message includes expected/observed paths when present.
- Do not auto-discover another file after any explicit workspace or containment failure.

- [ ] **Step 5: Run focused tests and existing planning tests**

```bash
npm test -- tests/crew/plan-workspace.test.ts tests/crew/plan-replan.test.ts tests/crew/plan-skills.test.ts
```

Expected: all pass.

Run TypeScript/LSP diagnostics on the five changed source files and the new test. Expected: no errors.

- [ ] **Step 6: Commit Task 2**

```bash
git add crew/types.ts crew/store.ts crew/handlers/plan.ts index.ts tests/crew/plan-workspace.test.ts
git commit -m "feat: bind Crew plans to explicit worktrees"
```

---

### Task 3: Guard common child launches and expose the workspace to children

**Files:**

- Modify: `crew/workspace.ts`
- Modify: `crew/agents.ts:45-209,211-482`
- Modify: `crew/index.ts:39-272`
- Create: `tests/crew/workspace-launch.test.ts`

**Interfaces:**

- Consumes: stored `Plan.workspace`
- Produces: `verifyPlanWorkspace(cwd: string): WorkspaceIdentity | null`
- Produces: `PI_CREW_WORKSPACE_ROOT` for workspace-backed children
- Preserves: ordinary child launch behavior when the plan has no workspace

- [ ] **Step 1: Write failing child-launch tests**

Create `tests/crew/workspace-launch.test.ts`. Reuse the process/spawn capture style from `tests/crew/superpowers-launch.test.ts`.

For a stored workspace-backed plan, call `spawnAgents` once for each Crew role (`planner`, `worker`, `reviewer`, `analyst`) and assert:

```ts
expect(capture.options.cwd).toBe(identity.root);
expect(capture.options.env.PI_CREW_WORKSPACE_ROOT).toBe(identity.root);
expect(fs.readFileSync(systemPromptPath, "utf8")).toContain(identity.root);
expect(fs.readFileSync(systemPromptPath, "utf8")).toContain("git rev-parse --show-toplevel");
```

Also assert:

- replacing `plan.workspace.gitDir` with the other worktree's Git directory rejects before `spawn()`;
- a plan without `workspace` keeps the existing `cwd`, environment, and prompt behavior;
- workspace mismatch returned through `executeCrewAction("work", ...)` has `details.error === "workspace_mismatch"` and leaves a ready task as `todo`.

- [ ] **Step 2: Run the test to verify RED**

```bash
npm test -- tests/crew/workspace-launch.test.ts
```

Expected: FAIL because stored workspace verification and child guidance are absent.

- [ ] **Step 3: Add one stored-plan verification helper**

In `crew/workspace.ts`, add:

```ts
export function verifyPlanWorkspace(cwd: string): WorkspaceIdentity | null;
```

It reads `store.getPlan(cwd)?.workspace`, returns `null` when absent, and otherwise calls `verifyWorkspace`. Keep this as the only store-aware workspace helper.

- [ ] **Step 4: Harden `spawnAgents` once for all fresh child roles**

At the start of `spawnAgents`:

```ts
const workspace = verifyPlanWorkspace(cwd);
const launchCwd = workspace?.root ?? cwd;
```

Pass `workspace` and `launchCwd` into `runAgent`. In `runAgent`:

- append `workspacePrompt(workspace)` to the temporary system-prompt file for every role;
- set `PI_CREW_WORKSPACE_ROOT` only when workspace exists;
- spawn with `cwd: launchCwd`;
- leave all behavior unchanged when workspace is `null`.

This single boundary covers plan, work, review, revision, and plan-sync calls that already use `spawnAgents`.

- [ ] **Step 5: Add a controller preflight before state-changing launch actions**

In `crew/index.ts`, before routing these actions, call `verifyPlanWorkspace(ctx.cwd)` when a stored plan has workspace identity:

```text
work
review
sync
task.revise
task.revise-tree
```

Return the stable `WorkspaceError.code` instead of entering the handler. Do not guard read-only status/list/show actions or `work.stop`/`plan.cancel`.

Keep the `spawnAgents` check as defense in depth for direct/internal calls.

- [ ] **Step 6: Run focused and regression tests**

```bash
npm test -- tests/crew/workspace-launch.test.ts tests/crew/superpowers-launch.test.ts tests/crew/agent-events.test.ts tests/crew/plan-replan.test.ts
```

Expected: all pass.

Run TypeScript/LSP diagnostics on `crew/workspace.ts`, `crew/agents.ts`, `crew/index.ts`, and the new test. Expected: no errors.

- [ ] **Step 7: Commit Task 3**

```bash
git add crew/workspace.ts crew/agents.ts crew/index.ts tests/crew/workspace-launch.test.ts
git commit -m "feat: enforce workspace on Crew child launches"
```

---

### Task 4: Make lobby workers workspace-safe

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

Extend `tests/crew/lobby.test.ts` with focused cases:

1. A lobby worker spawned for a workspace-backed plan uses the canonical `cwd`, receives `PI_CREW_WORKSPACE_ROOT`, and receives workspace system guidance.
2. `isLobbyWorkerCompatible` accepts identical workspace identities.
3. It rejects a lobby worker with no identity for a workspace-backed task.
4. It rejects a lobby worker from another linked worktree in the same repository.
5. `spawnWorkerForTask` verifies the stored workspace before changing the task from `todo`.

- [ ] **Step 2: Run the lobby tests to verify RED**

```bash
npm test -- tests/crew/lobby.test.ts
```

Expected: new cases fail.

- [ ] **Step 3: Store and compare lobby workspace identity**

Add optional `workspace` to `LobbyWorkerEntry` and `LobbyCompatibility`. Compare identity by exact `root`, `gitDir`, and `gitCommonDir` values; two absent identities remain compatible for ordinary Crew plans.

In `spawnLobbyWorker`:

- call `verifyPlanWorkspace(cwd)` before spawning;
- use the canonical root as `cwd`;
- add `PI_CREW_WORKSPACE_ROOT` and `workspacePrompt()` when present;
- store the identity on the returned/registered lobby worker.

In `crew/handlers/work.ts`, include `plan.workspace` in every `LobbyCompatibility` requirement.

In both `assignTaskToLobbyWorker` and `spawnWorkerForTask`, verify that the current plan identity matches the worker identity before changing task or alive-file state.

- [ ] **Step 4: Run lobby and work regressions**

```bash
npm test -- tests/crew/lobby.test.ts tests/crew/team-work.test.ts tests/crew/work-stop.test.ts tests/crew/graceful-shutdown.test.ts
```

Expected: all pass.

Run TypeScript/LSP diagnostics on the three changed source files and the test. Expected: no errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add crew/registry.ts crew/lobby.ts crew/handlers/work.ts tests/crew/lobby.test.ts
git commit -m "feat: bind lobby workers to plan worktrees"
```

---

### Task 5: Make the Superpowers handoff contract explicit

**Files:**

- Modify: `crew/superpowers-policy.ts:5-12`
- Modify: `tests/crew/superpowers-policy.test.ts:72-122`
- Modify: `index.ts:405-520`
- Modify: `skills/pi-messenger-crew/SKILL.md`

**Interfaces:**

- Consumes: existing `plan` action with `prd` and `workspace`
- Produces: controlling-agent instructions that preserve the exact plan and worktree paths

- [ ] **Step 1: Strengthen the failing policy test**

Extend the active-policy test to require all of these literal contract signals:

```ts
expect(result).toContain('prd: "<exact implementation-plan path>"');
expect(result).toContain('workspace: "<absolute linked-worktree path>"');
expect(result).toContain("Do not use bare plan auto-discovery");
expect(result).toContain("Do not replace the implementation plan with a summary");
expect(result).toContain("enter the linked worktree before starting Crew planning");
```

Keep the inactive, child-marker, and idempotency tests unchanged.

- [ ] **Step 2: Run the policy test to verify RED**

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: FAIL because the injected policy lacks the explicit call contract.

- [ ] **Step 3: Update only the packaged outer policy**

Add a short paragraph to `OUTER_POLICY` in `crew/superpowers-policy.ts`:

```text
When writing-plans produced an implementation plan, enter the linked worktree before starting Crew planning. Pass the exact paths with pi_messenger({ action: "plan", prd: "<exact implementation-plan path>", workspace: "<absolute linked-worktree path>" }). Do not use bare plan auto-discovery and do not replace the implementation plan with a summary. Crew verifies the worktree but does not create or switch it.
```

Do not modify stock Superpowers files or child prompts here.

- [ ] **Step 4: Update public tool help and the packaged Crew skill**

In the `pi_messenger` tool description in `index.ts`, add one plan example:

```ts
pi_messenger({ action: "plan", prd: "docs/superpowers/plans/feature.md", workspace: "/abs/worktree" })
```

In `skills/pi-messenger-crew/SKILL.md`, add the same example and explain in two sentences:

- Superpowers handoffs must pass both exact paths.
- Crew verifies but never creates or switches the worktree.

- [ ] **Step 5: Run focused tests and full verification**

```bash
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/plan-workspace.test.ts tests/crew/workspace-launch.test.ts tests/crew/lobby.test.ts
npm test
npx tsc --noEmit
```

Expected: all tests pass and TypeScript reports no errors.

Run `lens_diagnostics` in `all` mode and resolve every blocking error in edited files before completion.

- [ ] **Step 6: Commit Task 5**

```bash
git add crew/superpowers-policy.ts tests/crew/superpowers-policy.test.ts index.ts skills/pi-messenger-crew/SKILL.md
git commit -m "docs: require exact Superpowers Crew handoff"
```

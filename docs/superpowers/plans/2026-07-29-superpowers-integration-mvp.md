# Superpowers Integration MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give existing Crew workers and reviewers compact guidance from a separately installed official stock Superpowers package while preserving native pi-messenger behavior on absence or incompatibility.

**Architecture:** Capture Pi's authoritative loaded skill metadata in the parent extension, evaluate it with one concrete in-process adapter, and append a complete role selection at the existing `spawnAgents()` boundary. Add one final child-only extension that removes only the marked stock bootstrap and marked legacy policy suffix for active Crew children; expose in-memory state through existing status and warning paths.

**Tech Stack:** TypeScript, Pi extension lifecycle APIs, Node.js filesystem/Git process APIs, Vitest, existing Crew spawn/status/result helpers.

## Global Constraints

- Keep the implementation concrete and small: no provider interface, registry, scheduler, process manager, migration framework, persistence layer, or new configuration subsystem.
- Support only existing `worker` and `reviewer` Crew roles in this MVP.
- Worker starting skills are exactly `test-driven-development` and `verification-before-completion`; reviewer starting skill is exactly `verification-before-completion`.
- Stock Superpowers remains separately installed; do not copy or modify any Superpowers skill or extension file.
- Accept official `obra/superpowers` Git package metadata and identifiable local Git checkouts whose `origin` is official `obra/superpowers`.
- Initially support Superpowers major version `6` only.
- Other Pi-loaded user, project, and package skills remain available.
- Prohibit starting nested orchestration and creating, switching to, or managing nested worktrees; operating inside the checkout assigned by Crew remains allowed.
- Missing Superpowers is silent. Incomplete, shadowed, ambiguous, or incompatible Superpowers produces complete native fallback with one actionable warning.
- Do not change task, plan, scheduler, attempt, review, repair, recovery, artifact, routing, or planner semantics.
- Do not cherry-pick or merge the experimental Phase 1A execution branch.
- Execute this plan in an isolated worktree created with the `using-git-worktrees` skill.
- Every task uses focused RED/GREEN verification, one reviewer gate, and one commit.
- A task edits at most four files. A step performs one bounded action; split a step before implementation if it cannot be completed in roughly 2–5 minutes.

## File Structure

### Production

- Create `crew/superpowers.ts` — concrete installation state, role selection, guidance rendering, status rendering, warning deduplication, and latest in-memory launch state.
- Create `crew/superpowers-guard.ts` — final child-only Pi extension plus pure marker-removal helpers.
- Modify `crew/agents.ts` — apply a complete active selection at the existing launch boundary; do nothing in inactive/fallback.
- Modify `index.ts` — capture authoritative `Skill[]` and attach pending fallback warnings to tool results.
- Modify `crew/handlers/status.ts` — append compact adapter status and structured details.
- Modify `README.md` — explain automatic activation, Crew/Superpowers ownership, fallback, and other-skill availability.

### Tests and supervised acceptance

- Create `tests/helpers/superpowers.ts` — canonical temporary stock-package fixture shared by focused tests.
- Create `tests/crew/superpowers.test.ts` — installation, selection, rendering, status, and warning unit tests.
- Create `tests/crew/superpowers-launch.test.ts` — spawn arguments, environment, prompt composition, and native fallback tests.
- Create `tests/crew/superpowers-guard.test.ts` — exact child marker filtering tests.
- Create `tests/crew/superpowers-extension.test.ts` — Pi lifecycle capture and warning-delivery tests.
- Modify `tests/crew/status.test.ts` — active/inactive/fallback status assertions.
- Create `evals/definitions/integration-mvp.md` — fixed supervised MVP acceptance contract.
- Create `evals/fixtures/integration-mvp/seed/` — deterministic preplanned worker/reviewer fixture with one unrelated project skill.
- Create `evals/scripts/reset-integration-mvp.mjs` — safe reset only; never launches Pi or a model.
- Create `evals/scripts/verify-integration-mvp.mjs` — deterministic repository, task-state, worktree, and JSONL evidence checks.
- Create `evals/results/integration-mvp-TEMPLATE.md` — compact supervised result record.
- Create `tests/evals/integration-mvp.test.ts` — seed, reset, and verifier contract tests.
- Modify `evals/README.md` — exact human-supervised commands and evidence boundaries.

---

### Task 1: Validate an official stock Superpowers installation

**Files:**

- Create: `tests/helpers/superpowers.ts`
- Create: `tests/crew/superpowers.test.ts`
- Create: `crew/superpowers.ts`

**Interfaces:**

- Consumes: Pi `Skill` records from `@earendil-works/pi-coding-agent`.
- Produces:

```ts
export interface SkillRef {
  name: string;
  description: string;
  filePath: string;
}

export type SuperpowersState =
  | { status: "inactive" }
  | { status: "fallback"; reason: string; correctiveAction: string; version?: string }
  | {
      status: "active";
      version: string;
      packageRoot: string;
      skills: Record<"test-driven-development" | "verification-before-completion", SkillRef>;
    };

export function captureSuperpowersSkills(skills: readonly Skill[]): SuperpowersState;
export function getSuperpowersState(): SuperpowersState;
export function resetSuperpowersStateForTests(): void;
```

- [ ] **Step 1: Create the shared stock-package test fixture**

Create `tests/helpers/superpowers.ts` with `createStockSuperpowersFixture(options?)`, returning `{ root, skills, cleanup }`. It must write:

```text
package.json                                {"name":"superpowers","version":"6.2.0"}
.pi/extensions/superpowers.ts               contains the exact stock bootstrap marker
skills/using-superpowers/SKILL.md
skills/test-driven-development/SKILL.md
skills/verification-before-completion/SKILL.md
```

Each returned `Skill` uses:

```ts
sourceInfo: {
  path: filePath,
  source: options?.source ?? "git:github.com/obra/superpowers",
  scope: "user",
  origin: "package",
  baseDir: root,
}
```

Options must support `version`, `source`, `omitSkill`, and `bootstrapMarker` so later tests do not duplicate setup.

- [ ] **Step 2: Write absence and official-package tests**

In `tests/crew/superpowers.test.ts`, add:

```ts
beforeEach(resetSuperpowersStateForTests);
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

it("is inactive and silent when Superpowers is absent", () => {
  expect(captureSuperpowersSkills([])).toEqual({ status: "inactive" });
  expect(getSuperpowersState()).toEqual({ status: "inactive" });
});

it("accepts one official Git package with the required stock files", () => {
  const fixture = track(createStockSuperpowersFixture());
  expect(captureSuperpowersSkills(fixture.skills)).toMatchObject({
    status: "active",
    version: "6.2.0",
    packageRoot: fs.realpathSync(fixture.root),
  });
});
```

- [ ] **Step 3: Run the first adapter tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: FAIL because `crew/superpowers.ts` does not exist.

- [ ] **Step 4: Add state types and official source normalization**

In `crew/superpowers.ts`, add the exported types, module state, reset/get functions, and:

```ts
const SUPPORTED_MAJOR = 6;
const REQUIRED_NAMES = ["test-driven-development", "verification-before-completion"] as const;
const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";

function normalizeOfficialSource(value: string): string {
  return value.trim()
    .replace(/^git:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git(?=@|$)/, "")
    .replace(/@[^/]+$/, "");
}

function isOfficialSource(value: string): boolean {
  return normalizeOfficialSource(value) === "obra/superpowers";
}
```

Implement only enough `captureSuperpowersSkills` to distinguish absence from one official package source and store the result.

- [ ] **Step 5: Run the first adapter tests to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: PASS for the two tests added in Step 2.

- [ ] **Step 6: Add failing package-structure tests**

Add table-driven cases for invalid version, unsupported major version, omitted required skill, and missing bootstrap marker:

```ts
it.each([
  [{ version: "invalid" }, "invalid Superpowers version"],
  [{ version: "7.0.0" }, "unsupported Superpowers major version"],
  [{ omitSkill: "test-driven-development" }, "test-driven-development"],
  [{ bootstrapMarker: false }, "bootstrap marker"],
])("falls back completely for an incomplete package", (options, reason) => {
  const fixture = track(createStockSuperpowersFixture(options));
  expect(captureSuperpowersSkills(fixture.skills)).toMatchObject({
    status: "fallback",
    reason: expect.stringContaining(reason),
  });
});
```

- [ ] **Step 7: Run package-structure tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: FAIL on the new incomplete-package cases.

- [ ] **Step 8: Validate package metadata and canonical stock paths**

Extend `captureSuperpowersSkills` to:

1. Resolve one canonical package root from `sourceInfo.baseDir` with `fs.realpathSync`.
2. Require `package.json` name `superpowers` and version matching `^6\.\d+\.\d+`.
3. Require the stock extension file to contain the exact bootstrap marker.
4. Require each selected canonical path to equal `<root>/skills/<name>/SKILL.md` and be readable.
5. Catch filesystem/process failures and return one bounded fallback reason rather than throw.

- [ ] **Step 9: Run package-structure tests to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: PASS through the package-structure cases.

- [ ] **Step 10: Verify Task 1**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on the three Task 1 files.

- [ ] **Step 11: Commit Task 1**

```bash
git add crew/superpowers.ts tests/helpers/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: validate stock Superpowers package structure"
```

---

### Task 2: Validate local provenance and catalog conflicts

**Files:**

- Modify: `crew/superpowers.ts`
- Modify: `tests/crew/superpowers.test.ts`

**Interfaces:**

- Consumes: Task 1's `captureSuperpowersSkills` and validated stock package structure.
- Produces: official local-checkout support and fail-closed shadow/ambiguity behavior.

- [ ] **Step 1: Add failing local-origin tests**

Add these two cases:

```ts
it("accepts a local checkout only when Git origin is official", () => {
  const fixture = track(createStockSuperpowersFixture());
  execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:obra/superpowers.git"], { cwd: fixture.root });
  const skills = fixture.skills.map((skill) => ({
    ...skill,
    sourceInfo: { ...skill.sourceInfo, source: fixture.root },
  }));
  expect(captureSuperpowersSkills(skills).status).toBe("active");
});

it("rejects a local checkout with a fork origin", () => {
  const fixture = track(createStockSuperpowersFixture());
  execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/superpowers.git"], { cwd: fixture.root });
  const skills = fixture.skills.map((skill) => ({
    ...skill,
    sourceInfo: { ...skill.sourceInfo, source: fixture.root },
  }));
  expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
});
```

- [ ] **Step 2: Run local-origin tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "local checkout"
```

- [ ] **Step 3: Implement local Git provenance checks**

When the source is local, run only `git -C <root> remote get-url origin`, normalize the result, and require official `obra/superpowers`. Convert missing Git metadata and fork origins into deterministic fallback reasons.

- [ ] **Step 4: Run local-origin tests to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "local checkout"
```

- [ ] **Step 5: Add failing shadow and ambiguity tests**

Add one project-shadow case by changing the selected TDD skill to `origin: "top-level", scope: "project"`; require fallback reason `shadowed`. Add one two-root case by concatenating required skills from two tracked official fixtures; require fallback reason `ambiguous`.

- [ ] **Step 6: Run conflict tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "shadow|ambiguous"
```

- [ ] **Step 7: Implement fail-closed conflict detection**

Require `sourceInfo.origin === "package"` for selected stock skills. Reject required names spanning roots, duplicate candidates, project shadows, or non-stock selected paths. Return the first deterministic reason and corrective action. Do not add a package scanner, provider API, cache, or persistence.

- [ ] **Step 8: Verify Task 2**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 2 files. Expected: tests pass and no blocking diagnostics.

- [ ] **Step 9: Commit Task 2**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: validate Superpowers catalog provenance"
```

---

### Task 3: Select and render role-specific guidance

**Files:**

- Modify: `crew/superpowers.ts`
- Modify: `tests/crew/superpowers.test.ts`

**Interfaces:**

- Consumes: Task 2's validated active `SuperpowersState`.
- Produces:

```ts
export type SupportedSuperpowersRole = "worker" | "reviewer";
export interface SuperpowersSelectionRecord {
  status: "active";
  role: SupportedSuperpowersRole;
  assignmentId?: string;
  packageVersion: string;
  packageRoot: string;
  selectedSkills: Array<SkillRef & { reason: string }>;
  prohibitedWorkflows: string[];
}
export function prepareSuperpowersLaunch(role: string, assignmentId?: string): SuperpowersSelectionRecord | undefined;
export function renderSuperpowersGuidance(record: SuperpowersSelectionRecord): string;
```

- [ ] **Step 1: Write failing role-selection tests**

Use one tracked active fixture. Assert:

```ts
expect(prepareSuperpowersLaunch("worker", "task-1")?.selectedSkills.map((skill) => skill.name)).toEqual([
  "test-driven-development",
  "verification-before-completion",
]);
expect(prepareSuperpowersLaunch("reviewer")?.selectedSkills.map((skill) => skill.name)).toEqual([
  "verification-before-completion",
]);
expect(prepareSuperpowersLaunch("planner")).toBeUndefined();
```

- [ ] **Step 2: Run role-selection tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: FAIL because `prepareSuperpowersLaunch` is missing.

- [ ] **Step 3: Implement fixed role rules**

Add:

```ts
const ROLE_RULES = {
  worker: [
    ["test-driven-development", "Apply RED-GREEN-REFACTOR to behavior changes."],
    ["verification-before-completion", "Run fresh checks before completion claims."],
  ],
  reviewer: [
    ["verification-before-completion", "Verify evidence supporting the review verdict."],
  ],
} as const;
```

Return `undefined` for unsupported roles or non-active state. Preserve row order and assignment ID.

- [ ] **Step 4: Run role-selection tests to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: role-selection tests pass.

- [ ] **Step 5: Write the failing guidance-rendering test**

Assert the worker rendering contains both selected skills, three ownership restrictions, and `Other relevant installed skills remain available`; it must not mention `writing-plans` and must remain below 1,500 characters.

- [ ] **Step 6: Run guidance-rendering test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: FAIL because rendering is missing.

- [ ] **Step 7: Implement compact guidance rendering**

Render only the selection rows plus:

```ts
const PROHIBITED_WORKFLOWS = [
  "Do not start nested agents or SDD controllers.",
  "Do not start plan executors or branch-finishing workflows.",
  "Do not create, switch to, or manage nested worktrees; use the checkout assigned by Crew.",
];
```

Do not filter or rewrite Pi's loaded skill catalog.

- [ ] **Step 8: Verify Task 3**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 3 files.

- [ ] **Step 9: Commit Task 3**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: select Superpowers guidance by Crew role"
```

---

### Task 4: Suppress marked duplicate child guidance

**Files:**

- Create: `crew/superpowers-guard.ts`
- Create: `tests/crew/superpowers-guard.test.ts`

**Interfaces:**

```ts
export const SUPERPOWERS_CHILD_FLAG = "PI_CREW_SUPERPOWERS_MVP";
export const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
export const LEGACY_POLICY_MARKER = "<!-- crew-superpowers-policy:";
export function stripStockBootstrap(messages: unknown[]): unknown[];
export function stripLegacyPolicy(systemPrompt: string): string;
```

- [ ] **Step 1: Write exact marker-removal tests**

Test that a message containing the stock marker is removed while messages before and after remain byte-for-byte equal. Test that only a suffix beginning at the legacy marker is removed from a system prompt.

- [ ] **Step 2: Run marker-removal tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts
```

Expected: FAIL because the guard module is missing.

- [ ] **Step 3: Implement the two pure marker helpers**

Inspect string content and text content parts only. Do not mutate retained messages. `stripLegacyPolicy` returns the original prompt when its exact marker is absent.

- [ ] **Step 4: Run marker-removal tests to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts
```

- [ ] **Step 5: Write failing extension-activation tests**

Register the default export against a mock `ExtensionAPI`. Assert zero handlers unless both conditions hold:

```ts
process.env.PI_CREW_SUPERPOWERS_MVP === "1"
["worker", "reviewer"].includes(process.env.PI_CREW_ROLE ?? "")
```

Assert active children register one `before_agent_start` and one `context` handler.

- [ ] **Step 6: Run extension-activation tests to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts
```

- [ ] **Step 7: Implement the child-only extension registration**

The `before_agent_start` handler returns `stripLegacyPolicy(event.systemPrompt)`. The `context` handler returns `stripStockBootstrap(event.messages)`. Import no Crew state, store, or configuration.

- [ ] **Step 8: Verify Task 4**

```bash
npm exec vitest -- run tests/crew/superpowers-guard.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 4 files.

- [ ] **Step 9: Commit Task 4**

```bash
git add crew/superpowers-guard.ts tests/crew/superpowers-guard.test.ts
git commit -m "feat: guard Crew children from duplicate guidance"
```

---

### Task 5: Capture Pi's authoritative loaded skill catalog

**Files:**

- Modify: `index.ts`
- Create: `tests/crew/superpowers-extension.test.ts`

**Interfaces:**

- Consumes: Task 1's `captureSuperpowersSkills`.
- Produces: one root `before_agent_start` hook that forwards `event.systemPromptOptions.skills` unchanged.

- [ ] **Step 1: Create the root-extension test harness**

Follow the handler-map mock in `tests/status-heartbeat.test.ts`. Load the default extension and retain all registered handlers by event name.

- [ ] **Step 2: Write the failing catalog-forwarding test**

Pass one untrusted `using-superpowers` candidate through the registered `before_agent_start` event and assert `getSuperpowersState()` changes from inactive to fallback with an official-provenance reason.

- [ ] **Step 3: Run the lifecycle test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
```

Expected: FAIL because the root hook does not capture skills.

- [ ] **Step 4: Register the catalog-capture hook**

In `index.ts`:

```ts
pi.on("before_agent_start", (event) => {
  captureSuperpowersSkills(event.systemPromptOptions.skills ?? []);
});
```

Do not scan settings or package directories from `index.ts`.

- [ ] **Step 5: Verify Task 5**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 5 files.

- [ ] **Step 6: Commit Task 5**

```bash
git add index.ts tests/crew/superpowers-extension.test.ts
git commit -m "feat: capture Pi loaded skills for Crew"
```

---

### Task 6: Apply active guidance at the Crew launch boundary

**Files:**

- Modify: `crew/agents.ts`
- Create: `tests/crew/superpowers-launch.test.ts`

**Interfaces:**

- Consumes: Task 3's `prepareSuperpowersLaunch` and `renderSuperpowersGuidance`; Task 4's guard path.
- Produces: active-only child prompt, guard extension, and environment metadata.

- [ ] **Step 1: Create a spawn-capture test harness**

Follow `tests/crew/model-override.test.ts`. Capture spawn arguments, options, and append-prompt file content synchronously before the mocked close event removes the file.

- [ ] **Step 2: Write the failing worker-prompt test**

Activate the shared fixture, spawn one worker task, and require the captured append prompt to contain TDD followed by verification guidance.

- [ ] **Step 3: Run worker-prompt test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "worker prompt"
```

- [ ] **Step 4: Append active worker guidance**

Resolve role first, call `prepareSuperpowersLaunch(role, task.taskId)` once, and append `renderSuperpowersGuidance(selection)` through the existing secure prompt-file path.

- [ ] **Step 5: Run worker-prompt test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "worker prompt"
```

- [ ] **Step 6: Write the failing child-activation test**

Require the normal extension before `superpowers-guard.ts` and:

```ts
expect(spawnOptions.env).toMatchObject({
  PI_CREW_ROLE: "worker",
  PI_CREW_SUPERPOWERS_MVP: "1",
});
```

- [ ] **Step 7: Run child-activation test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "child activation"
```

- [ ] **Step 8: Add active child guard and environment metadata**

Add the guard extension second and active-only environment keys. Keep existing `PI_CREW_WORKER` and `PI_AGENT_NAME` behavior unchanged.

- [ ] **Step 9: Run child-activation test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "child activation"
```

- [ ] **Step 10: Verify Task 6**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "worker prompt|child activation"
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 6 files.

- [ ] **Step 11: Commit Task 6**

```bash
git add crew/agents.ts tests/crew/superpowers-launch.test.ts
git commit -m "feat: guide active Crew worker launches"
```

---

### Task 7: Preserve reviewer, override, and native launch behavior

**Files:**

- Modify: `crew/agents.ts`
- Modify: `tests/crew/superpowers-launch.test.ts`

**Interfaces:**

- Consumes: Task 6's active-only launch integration.
- Produces: reviewer role mapping, override composition, and complete native fallback equivalence.

- [ ] **Step 1: Write reviewer prompt test**

Spawn a reviewer and require verification guidance without the worker's required TDD row.

- [ ] **Step 2: Run reviewer prompt test**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "reviewer"
```

- [ ] **Step 3: Write project-override composition test**

Require the existing project override to remain unchanged and appear before the appended integration guidance.

- [ ] **Step 4: Run project-override test**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "project override"
```

- [ ] **Step 5: Write native inactive/fallback equivalence tests**

Compare args, environment, and append prompt against a reset baseline. Both inactive and fallback runs must have no guard path, no `PI_CREW_ROLE`, no MVP flag, and no integration guidance.

- [ ] **Step 6: Run native equivalence tests**

```bash
npm exec vitest -- run tests/crew/superpowers-launch.test.ts -t "inactive|fallback"
```

- [ ] **Step 7: Verify Task 7**

```bash
npm exec vitest -- run \
  tests/crew/superpowers-launch.test.ts \
  tests/crew/model-override.test.ts \
  tests/crew/graceful-shutdown.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 7 files.

- [ ] **Step 8: Commit Task 7**

```bash
git add crew/agents.ts tests/crew/superpowers-launch.test.ts
git commit -m "test: preserve native Crew launch behavior"
```

---

### Task 8: Render compact integration state

**Files:**

- Modify: `crew/superpowers.ts`
- Modify: `tests/crew/superpowers.test.ts`

**Interfaces:**

```ts
export function renderSuperpowersStatus(): string;
export function getSuperpowersStatusDetails(): Record<string, unknown>;
```

- [ ] **Step 1: Write inactive renderer test**

Require compact inactive text, no warning icon, and structured details status `inactive`.

- [ ] **Step 2: Run inactive renderer test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "inactive status"
```

- [ ] **Step 3: Implement inactive status exports**

Return compact text/details without mutating warning state.

- [ ] **Step 4: Run inactive renderer test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "inactive status"
```

- [ ] **Step 5: Write active latest-launch renderer test**

Activate a fixture, prepare worker `task-1`, and require version, fixed mappings, and latest launch.

- [ ] **Step 6: Run active renderer test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "latest launch"
```

- [ ] **Step 7: Store and render latest active selection**

Update only on active preparation, never persist it, and return root/version/mappings in details.

- [ ] **Step 8: Run active renderer test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "latest launch"
```

- [ ] **Step 9: Write fallback renderer test**

Require bounded reason and corrective action without taking or creating a warning.

- [ ] **Step 10: Run fallback renderer test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "fallback status"
```

- [ ] **Step 11: Render fallback state**

Add only fallback state fields to text/details and leave warning state untouched.

- [ ] **Step 12: Verify Task 8**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 8 files.

- [ ] **Step 13: Commit Task 8**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: render Superpowers integration state"
```

---

### Task 9: Expose integration state through Crew status

**Files:**

- Modify: `crew/handlers/status.ts`
- Modify: `tests/crew/status.test.ts`

**Interfaces:**

- Consumes: Task 8's status text and details renderers.
- Produces: one status section in no-plan and normal-plan results.

- [ ] **Step 1: Write no-plan handler test**

Invoke status without a plan and require one `## Superpowers` section plus inactive structured details.

- [ ] **Step 2: Run no-plan test to verify RED**

```bash
npm exec vitest -- run tests/crew/status.test.ts -t "inactive integration"
```

- [ ] **Step 3: Add state to no-plan status**

Compute adapter text/details before the no-plan branch and append both to that result.

- [ ] **Step 4: Run no-plan test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/status.test.ts -t "inactive integration"
```

- [ ] **Step 5: Write normal-plan handler test**

Create a plan, activate the adapter, and require the same single section plus active details.

- [ ] **Step 6: Run normal-plan test to verify RED**

```bash
npm exec vitest -- run tests/crew/status.test.ts -t "active integration"
```

- [ ] **Step 7: Add state to normal-plan status**

Append the already computed text/details to the normal result without changing existing plan formatting.

- [ ] **Step 8: Verify Task 9**

```bash
npm exec vitest -- run tests/crew/status.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 9 files.

- [ ] **Step 9: Commit Task 9**

```bash
git add crew/handlers/status.ts tests/crew/status.test.ts
git commit -m "feat: expose Superpowers state in Crew status"
```

---

### Task 10: Deduplicate fallback warnings in adapter state

**Files:**

- Modify: `crew/superpowers.ts`
- Modify: `tests/crew/superpowers.test.ts`

**Interfaces:**

```ts
export function takeSuperpowersWarning(): string | undefined;
```

- [ ] **Step 1: Write adapter warning-deduplication test**

After a fallback capture, call `prepareSuperpowersLaunch("worker", "task-1")`; require one warning containing reason, corrective action, and native continuation. A second launch with unchanged fallback fingerprint must not queue another warning.

- [ ] **Step 2: Run warning unit test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

- [ ] **Step 3: Implement pending warning state**

Queue a warning only from an attempted supported-role fallback launch. `takeSuperpowersWarning` returns and clears the pending value. Reset pending state in `resetSuperpowersStateForTests`.

- [ ] **Step 4: Run pending-warning test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

- [ ] **Step 5: Write changed-fingerprint test**

Capture a different fallback reason after consuming the first warning, attempt another worker launch, and require one new warning. Repeating that same reason must remain silent.

- [ ] **Step 6: Run changed-fingerprint test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts -t "changed fingerprint"
```

- [ ] **Step 7: Implement fallback fingerprint tracking**

Store only the last warned fallback fingerprint in memory. Do not persist it and do not queue warnings from status rendering or unsupported roles.

- [ ] **Step 8: Verify Task 10**

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on both Task 10 files.

- [ ] **Step 9: Commit Task 10**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: deduplicate Superpowers fallback warnings"
```

---

### Task 11: Deliver warnings and document ownership

**Files:**

- Modify: `index.ts`
- Modify: `tests/crew/superpowers-extension.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 10's `takeSuperpowersWarning`.
- Produces: one warning through existing tool result and optional UI notification.

- [ ] **Step 1: Write non-interactive result-prefix test**

Invoke the registered `pi_messenger` tool after a fallback launch attempt with `hasUI: false`. Require its first text block to start with `⚠ Superpowers integration fallback:`. Invoke again and require no prefix.

- [ ] **Step 2: Run result-prefix test to verify RED**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
```

- [ ] **Step 3: Attach pending warnings to existing tool results**

Immediately after `executeCrewAction(...)`, take the warning and prefix the first text block. Keep this inline; do not introduce warning middleware or a bus.

- [ ] **Step 4: Run result-prefix test to verify GREEN**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
```

- [ ] **Step 5: Add the UI notification assertion**

Run the same test with `hasUI: true`; require `ctx.ui.notify(warning, "warning")` and retain the result prefix so UI is never the sole signal.

- [ ] **Step 6: Add the optional UI notification**

When a warning exists and `ctx.hasUI` is true, call `ctx.ui.notify(superpowersWarning, "warning")` before returning the already-prefixed result.

- [ ] **Step 7: Run both delivery tests**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
```

- [ ] **Step 8: Document activation and ownership**

Add a `Superpowers integration` README section stating:

- stock Superpowers is separately installed;
- worker and reviewer starting mappings;
- other Pi skills remain available;
- Crew solely owns planning, dispatch, task state, review dispatch, and repository coordination;
- children cannot start nested orchestration or nested worktrees;
- status shows active/inactive/fallback;
- absence is silent and invalid installations warn once with native continuation; and
- the legacy global policy extension may be removed, while its exact marked suffix is ignored during migration.

- [ ] **Step 9: Verify Task 11**

```bash
npm exec vitest -- run tests/crew/superpowers-extension.test.ts
npm exec tsc -- --noEmit
```

Run `lsp_diagnostics` on all three Task 11 files.

- [ ] **Step 10: Commit Task 11**

```bash
git add index.ts tests/crew/superpowers-extension.test.ts README.md
git commit -m "feat: deliver Superpowers fallback warnings"
```

---

### Task 12: Define the supervised acceptance contract

**Files:**

- Create: `evals/definitions/integration-mvp.md`
- Create: `evals/fixtures/integration-mvp/seed/PRD.md`
- Create: `evals/fixtures/integration-mvp/seed/.pi/skills/project-style/SKILL.md`
- Create: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

- Produces: fixed acceptance prose and one distinctive unrelated project skill.

- [ ] **Step 1: Write the acceptance definition**

Require one preplanned `clamp(value, min, max)` task, worker reads of stock TDD/verification/project-style, worker `pi_messenger` completion, reviewer verification read, one worktree, no nested dispatch/Pi/worktree calls, passing tests, done task state, and a separate silent inactive run.

- [ ] **Step 2: Write the fixture PRD**

Specify named export `clamp`, below/inside/above range behavior, and `RangeError` when `min > max`. State that the worker must use tests first and existing automatic review.

- [ ] **Step 3: Write the unrelated project skill**

Use valid frontmatter:

```markdown
---
name: project-style
description: Preserve the fixture's public module style.
---

Keep `clamp` as a named export. Do not add a default export.
```

- [ ] **Step 4: Write contract-content tests**

Assert the definition names all required worker/reviewer evidence and the skill contains the named-export rule. Assert no fixture file contains copied stock Superpowers prose.

- [ ] **Step 5: Run Task 12 tests**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts tests/evals/definitions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 12**

```bash
git add \
  evals/definitions/integration-mvp.md \
  evals/fixtures/integration-mvp/seed/PRD.md \
  evals/fixtures/integration-mvp/seed/.pi/skills/project-style/SKILL.md \
  tests/evals/integration-mvp.test.ts
git commit -m "test: define Superpowers integration acceptance"
```

---

### Task 13: Create the failing code fixture

**Files:**

- Create: `evals/fixtures/integration-mvp/seed/package.json`
- Create: `evals/fixtures/integration-mvp/seed/src/clamp.mjs`
- Create: `evals/fixtures/integration-mvp/seed/test/clamp.test.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

- [ ] **Step 1: Write the fixture package metadata**

```json
{
  "name": "integration-mvp-fixture",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 2: Write the intentionally incomplete implementation**

```js
export function clamp() {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Write four fixture tests**

Use `node:test` and strict assertions for below range, inside range, above range, and `min > max` throwing `RangeError`.

- [ ] **Step 4: Add the expected-failure seed test**

Spawn `npm test` in the seed and assert nonzero exit plus `not implemented`. This confirms the live worker receives a genuine failing starting point.

- [ ] **Step 5: Run Task 13 tests**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts
```

Expected: PASS because the harness expects the seed's inner test command to fail.

- [ ] **Step 6: Commit Task 13**

```bash
git add evals/fixtures/integration-mvp/seed tests/evals/integration-mvp.test.ts
git commit -m "test: add failing integration code fixture"
```

---

### Task 14: Preseed the Crew plan and configuration

**Files:**

- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/config.json`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/plan.json`
- Modify: `tests/evals/integration-mvp.test.ts`

- [ ] **Step 1: Write bounded fixture configuration**

```json
{
  "review": { "enabled": true, "maxIterations": 1 },
  "artifacts": { "enabled": true, "cleanupDays": 1 },
  "concurrency": { "workers": 1, "max": 1 }
}
```

- [ ] **Step 2: Write one-task plan metadata**

```json
{
  "prd": "PRD.md",
  "created_at": "2026-07-29T00:00:00.000Z",
  "updated_at": "2026-07-29T00:00:00.000Z",
  "task_count": 1,
  "completed_count": 0
}
```

- [ ] **Step 3: Add configuration and plan assertions**

Parse both JSON files. Require review/artifacts enabled, concurrency one, task count one, and zero completed tasks.

- [ ] **Step 4: Run Task 14 tests**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts
```

- [ ] **Step 5: Commit Task 14**

```bash
git add evals/fixtures/integration-mvp/seed/.pi/messenger/crew tests/evals/integration-mvp.test.ts
git commit -m "test: preseed integration Crew configuration"
```

---

### Task 15: Preseed the single Crew task

**Files:**

- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.json`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.md`
- Modify: `tests/evals/integration-mvp.test.ts`

- [ ] **Step 1: Write task metadata**

```json
{
  "id": "task-1",
  "title": "Implement clamp with test-first evidence",
  "status": "todo",
  "depends_on": [],
  "skills": ["project-style"],
  "created_at": "2026-07-29T00:00:00.000Z",
  "updated_at": "2026-07-29T00:00:00.000Z",
  "attempt_count": 0
}
```

- [ ] **Step 2: Write the task brief**

Require reading `project-style`, observing the failing tests, implementing only `clamp`, running fresh tests, committing, and reporting completion through `pi_messenger`. Explicitly prohibit nested agents and nested worktrees.

- [ ] **Step 3: Add task-state assertions**

Parse task JSON and require `todo`, no dependencies, one project skill, and zero attempts. Require the Markdown brief to mention tests, commit, and `pi_messenger`.

- [ ] **Step 4: Run Task 15 tests**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts
```

- [ ] **Step 5: Commit Task 15**

```bash
git add evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks tests/evals/integration-mvp.test.ts
git commit -m "test: preseed integration Crew task"
```

---

### Task 16: Add a safe deterministic fixture reset

**Files:**

- Create: `evals/scripts/reset-integration-mvp.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

```js
export function resetIntegrationMvp({ repositoryRoot, destination, now }): {
  worktree: string;
  seedCommit: string;
  manifestPath: string;
};
```

- [ ] **Step 1: Write unsafe-destination tests**

Require rejection when destination is outside `evals/runs/integration-mvp` or when an existing destination lacks the matching marker.

- [ ] **Step 2: Run destination tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "reset destination"
```

- [ ] **Step 3: Implement path and replacement guards**

Use fixed fixture name `integration-mvp`. Resolve canonical paths, require descendants of the fixed run root, and replace only a directory with a matching marker.

- [ ] **Step 4: Run destination tests to verify GREEN**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "reset destination"
```

- [ ] **Step 5: Verify Task 16**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "reset destination"
```

- [ ] **Step 6: Commit Task 16**

```bash
git add evals/scripts/reset-integration-mvp.mjs tests/evals/integration-mvp.test.ts
git commit -m "test: guard integration reset destinations"
```

---

### Task 17: Create marked integration run state

**Files:**

- Modify: `evals/scripts/reset-integration-mvp.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

- Consumes: Task 16's guarded reset destination.
- Produces: copied/committed seed, marker, manifest, and bounded reset CLI.

- [ ] **Step 1: Write reset creation test**

Require reset to copy the seed, initialize and commit a Git repository, and return worktree plus seed commit.

- [ ] **Step 2: Run reset creation test to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "creates integration run"
```

- [ ] **Step 3: Implement seed copy and Git commit**

Copy the fixed seed, initialize Git, configure fixture-local identity, add files, and commit. Accept injected `now`; do not install packages or call the network.

- [ ] **Step 4: Write marker and manifest test**

Require `.git/pi-super-messenger-eval-marker.json` and a manifest containing fixture name, seed commit, immutable test hashes, and injected timestamp.

- [ ] **Step 5: Run marker and manifest test to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "marker and manifest"
```

- [ ] **Step 6: Write marker and manifest output**

Create both files under `.git` after the seed commit and return `manifestPath`.

- [ ] **Step 7: Run reset creation tests to verify GREEN**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "integration run|marker and manifest"
```

- [ ] **Step 8: Write CLI and no-model test**

Spy on process execution, invoke the CLI path, require zero `pi` or model commands, and require rejection of more than one destination argument.

- [ ] **Step 9: Run CLI test to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "bounded CLI"
```

- [ ] **Step 10: Implement the bounded CLI**

Accept zero or one destination argument, delegate to `resetIntegrationMvp`, and print returned paths as JSON. Do not launch Pi, copy auth, or invoke a model.

- [ ] **Step 11: Verify Task 17**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts
node evals/scripts/reset-integration-mvp.mjs
```

Confirm the command prints its worktree and manifest paths without launching Pi.

- [ ] **Step 12: Commit Task 17**

```bash
git add evals/scripts/reset-integration-mvp.mjs tests/evals/integration-mvp.test.ts
git commit -m "test: add safe integration fixture reset"
```

---

### Task 18: Verify repository and task-state evidence

**Files:**

- Create: `evals/scripts/verify-integration-mvp.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

```js
export function verifyIntegrationMvp({ repositoryRoot, worktree }): {
  status: "passed";
  workerTrace: string;
  reviewerTrace: string;
};
```

- [ ] **Step 1: Write marker and immutable-hash tests**

A synthetic run with the matching marker/manifest must pass. Changing one fixture test after reset must fail with an immutable-hash error.

- [ ] **Step 2: Run marker/hash tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "marker|immutable"
```

- [ ] **Step 3: Implement marker and hash validation**

Read the fixed marker and manifest, hash the listed immutable files, and throw a direct mismatch error.

- [ ] **Step 4: Run marker/hash tests to verify GREEN**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "marker|immutable"
```

- [ ] **Step 5: Write fixture-test and task-state tests**

Require `npm test` exit zero and `task-1.json` status `done`; add one failing case for each condition.

- [ ] **Step 6: Run fixture/task tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "fixture tests|task state"
```

- [ ] **Step 7: Implement fixture-test and task-state checks**

Run `npm test` in the worktree and parse the fixed task JSON path. Throw errors naming test failure or non-done status.

- [ ] **Step 8: Write the one-worktree test**

Mock `git worktree list --porcelain` with one and two `worktree` lines; require one to pass and two to fail.

- [ ] **Step 9: Run one-worktree test to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "one worktree"
```

- [ ] **Step 10: Implement the one-worktree check**

Count only lines beginning `worktree ` and require exactly one.

- [ ] **Step 11: Run repository-state tests to verify GREEN**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "fixture tests|task state|one worktree"
```

- [ ] **Step 12: Verify Task 18**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "marker|immutable|fixture tests|task state|one worktree"
```

Run `lsp_diagnostics` on both Task 18 files.

- [ ] **Step 13: Commit Task 18**

```bash
git add evals/scripts/verify-integration-mvp.mjs tests/evals/integration-mvp.test.ts
git commit -m "test: verify integration repository state"
```

---

### Task 19: Verify required worker and reviewer trace evidence

**Files:**

- Modify: `evals/scripts/verify-integration-mvp.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

- Consumes: Task 18's validated repository and task state.
- Produces: exact worker/reviewer trace discovery, parsing, and required methodology evidence.

- [ ] **Step 1: Write trace-discovery and parsing tests**

Create exactly one `*_crew-worker_*.jsonl` and one `*_crew-reviewer_*.jsonl`; add failures for missing/duplicate traces and malformed non-empty JSONL.

- [ ] **Step 2: Run trace-discovery tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "trace discovery"
```

- [ ] **Step 3: Implement bounded trace discovery and parsing**

Search only the Crew artifacts directory, require exactly one trace per role, and parse non-empty lines.

- [ ] **Step 4: Write required-evidence tests**

Require worker reads ending in stock TDD, stock verification, and project-style `SKILL.md`; require worker `pi_messenger`; require reviewer stock verification.

- [ ] **Step 5: Run required-evidence tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "required evidence"
```

- [ ] **Step 6: Implement required-evidence checks**

Inspect `tool_execution_start` events only and match normalized path suffixes plus exact tool name `pi_messenger`.

- [ ] **Step 7: Run required-evidence tests to verify GREEN**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "trace|required evidence"
```

- [ ] **Step 8: Verify Task 19**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "trace|required evidence"
```

- [ ] **Step 9: Commit Task 19**

```bash
git add evals/scripts/verify-integration-mvp.mjs tests/evals/integration-mvp.test.ts
git commit -m "test: verify required integration trace evidence"
```

---

### Task 20: Reject forbidden nested execution evidence

**Files:**

- Modify: `evals/scripts/verify-integration-mvp.mjs`
- Modify: `tests/evals/integration-mvp.test.ts`

**Interfaces:**

- Consumes: Task 19's parsed tool events.
- Produces: forbidden-call rejection and verifier CLI JSON output.

- [ ] **Step 1: Write forbidden-call tests**

Add separate failing traces for a `subagent`/dispatch tool, nested `pi` Bash command, and `git worktree add|move|remove`.

- [ ] **Step 2: Run forbidden-call tests to verify RED**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts -t "forbidden"
```

- [ ] **Step 3: Implement forbidden-call checks and CLI output**

Reject the exact forbidden classes, return the small result object, and print it as JSON from CLI. Do not build a trace-query language or generic eval runner.

- [ ] **Step 4: Verify Task 20**

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts tests/evals/definitions.test.ts
```

Run `lsp_diagnostics` on both Task 20 files.

- [ ] **Step 5: Commit Task 20**

```bash
git add evals/scripts/verify-integration-mvp.mjs tests/evals/integration-mvp.test.ts
git commit -m "test: verify integration live-run evidence"
```

---

### Task 21: Document and record supervised acceptance

**Files:**

- Modify: `evals/README.md`
- Create: `evals/results/integration-mvp-TEMPLATE.md`

- [ ] **Step 1: Document the active supervised commands**

Add:

```bash
node evals/scripts/reset-integration-mvp.mjs
cd evals/runs/integration-mvp/worktree
pi -e /absolute/path/to/super-pi-messenger
# In Pi: run pi_messenger({ action: "status" }), then pi_messenger({ action: "work" }).
cd /absolute/path/to/super-pi-messenger
node evals/scripts/verify-integration-mvp.mjs evals/runs/integration-mvp/worktree
```

- [ ] **Step 2: Document inactive fallback acceptance**

Require a fresh reset with Superpowers disabled in an isolated Pi agent directory. Status must be inactive, no warning may appear, and native Crew must complete with project override behavior unchanged.

- [ ] **Step 3: Document evidence boundaries**

State that scripts never launch models, raw traces remain ignored under `evals/runs`, and only reviewed sanitized results enter `evals/results`.

- [ ] **Step 4: Create the result template**

Add fields for repository commit, package version/root, active/inactive status, selected paths, task/test outcome, forbidden-call outcome, project-skill outcome, reviewer outcome, interventions, model usage when available, and sanitized evidence locations.

- [ ] **Step 5: Run documentation and repository checks**

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

Run `lens_diagnostics mode=all` for all files changed by Tasks 1–21. Fix only findings caused by this work.

- [ ] **Step 6: Commit Task 21**

```bash
git add evals/README.md evals/results/integration-mvp-TEMPLATE.md
git commit -m "docs: document Superpowers integration acceptance"
```

---

## Final supervised acceptance and release gate

The following is a human-supervised gate, not an editing task or automated model test.

- [ ] Create a fresh ignored fixture with `node evals/scripts/reset-integration-mvp.mjs`.
- [ ] Confirm stock Superpowers 6 is enabled and the legacy global policy extension may remain installed for coexistence testing.
- [ ] Launch the local package with the documented `pi -e` command.
- [ ] Run status; record active version, worker/reviewer mappings, and no duplicate legacy policy.
- [ ] Run the preplanned task through `pi_messenger({ action: "work" })`.
- [ ] Stop immediately if the worker lacks `pi_messenger`; add only a focused failing launcher-contract test and the smallest fix before repeating acceptance.
- [ ] Run `node evals/scripts/verify-integration-mvp.mjs <worktree>` and require PASS.
- [ ] Inspect raw JSONL before cleanup for methodology reads, unrelated project skill access, reviewer behavior, and absence of nested orchestration/worktrees.
- [ ] Repeat from a fresh reset with Superpowers disabled in an isolated agent directory; require inactive status, no warning, native completion, and unchanged project override behavior.
- [ ] Record a sanitized result from `evals/results/integration-mvp-TEMPLATE.md`; do not commit raw traces or credentials.
- [ ] Run final repository verification:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

- [ ] Run `lens_diagnostics mode=all` on all files changed by the implementation.
- [ ] Request independent code review against this plan and `docs/superpowers/specs/2026-07-29-superpowers-integration-mvp-design.md`.
- [ ] Do not call the MVP complete until deterministic checks, live active acceptance, live inactive fallback acceptance, and independent review all pass.

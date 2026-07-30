# Quality-First Crew SDD Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate Superpowers SDD into strict, quality-gated Crew execution while preserving opportunistic concurrency for genuinely independent tasks.

**Architecture:** Persist one optional existing dependency-mode value on `plan.json`, then let the existing config loader apply it as the highest-priority per-run override. This keeps every existing readiness path consistent without adding a workflow engine or duplicating scheduler logic. Strengthen the package-owned outer policy so the controller selects strict mode, uses native Crew reviews, and does not manufacture serialization or parallel work.

**Tech Stack:** TypeScript, Pi extension API, TypeBox tool schemas, Vitest, file-backed Crew plan state.

## Global Constraints

- Optimize for implementation quality, reliable unattended completion, reasonable token cost, then opportunistic wall-clock improvement.
- Configured concurrency is capacity, not a utilization target.
- SDD-integrated runs use strict dependency enforcement.
- Dependency-independent strict-ready tasks may execute concurrently up to configured concurrency.
- Do not speculate against unfinished interfaces or remove real dependencies to fill worker slots.
- Use Crew's native automatic review and repair; do not create implementation/review meta-task chains solely to imitate stock SDD.
- Do not mutate user or project configuration files.
- Non-SDD Crew behavior remains unchanged when no per-run override is supplied.
- Do not modify stock Superpowers or add a workflow engine, provider registry, migration layer, soft-dependency model, or generalized policy framework.
- Preserve validated-official-Superpowers-v6 gating, controlling-agent-only injection, idempotence, and child policy stripping.
- Checkout-root and premature assignment with `autoWork: false` remain separate defects; only dependency eligibility through existing dispatch paths is in scope.

---

### Task 1: Persist a Minimal Per-Run Dependency Override

**Files:**
- Modify: `crew/types.ts:15-22,70-125`
- Modify: `crew/store.ts:83-97`
- Modify: `crew/utils/config.ts:34-75,129-146`
- Modify: `crew/handlers/plan.ts:200-541`
- Modify: `index.ts:420-455`
- Test: `tests/crew/utils/config.test.ts`
- Test: `tests/crew/plan-replan.test.ts`

**Interfaces:**
- Produces: `DependencyMode = "advisory" | "strict"`.
- Produces: `Plan.dependencies?: DependencyMode` persisted in `.pi/messenger/crew/plan.json`.
- Produces: `CrewParams.dependencies?: DependencyMode` accepted by the `plan` and `work` actions.
- Produces: `createPlan(cwd, prdPath, prompt?, dependencies?)`.
- Invariant: `loadCrewConfig(crewDir).dependencies` resolves defaults, user config, project config, then a valid plan override.

- [ ] **Step 1: Add failing config precedence tests**

Extend the existing dependency test in `tests/crew/utils/config.test.ts` with a plan override and malformed-state case:

```ts
writeJson(path.join(dirs.crewDir, "config.json"), {
  dependencies: "advisory",
});
writeJson(path.join(dirs.crewDir, "plan.json"), {
  prd: "PRD.md",
  dependencies: "strict",
});
expect(loadCrewConfig(dirs.crewDir).dependencies).toBe("strict");

writeJson(path.join(dirs.crewDir, "plan.json"), {
  prd: "PRD.md",
  dependencies: "invalid",
});
expect(loadCrewConfig(dirs.crewDir).dependencies).toBe("advisory");
```

- [ ] **Step 2: Add a failing plan persistence test**

Add to the `plan with autoWork` block in `tests/crew/plan-replan.test.ts`:

```ts
it("persists a strict dependency override for the run", async () => {
  spawnAgents.mockResolvedValue([{
    exitCode: 0,
    output: plannerOutput,
    error: null,
    progress: { toolCallCount: 0, tokens: 0 },
  }]);

  await planHandler.execute(
    { action: "plan", autoWork: false, dependencies: "strict" },
    mockCtx,
    "agent",
  );

  expect(store.getPlan(tmpDir)?.dependencies).toBe("strict");
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/crew/utils/config.test.ts tests/crew/plan-replan.test.ts
```

Expected: FAIL because `Plan`, `CrewParams`, `createPlan()`, and `loadCrewConfig()` do not yet support a plan dependency override.

- [ ] **Step 4: Add the shared dependency type and plan fields**

In `crew/types.ts`, add and reuse one type:

```ts
export type DependencyMode = "advisory" | "strict";

export interface Plan {
  prd: string;
  prompt?: string;
  dependencies?: DependencyMode;
  created_at: string;
  updated_at: string;
  task_count: number;
  completed_count: number;
}
```

Add under plan/work options in `CrewParams`:

```ts
dependencies?: DependencyMode;
```

Update `CrewConfig.dependencies` in `crew/utils/config.ts` to use `DependencyMode` rather than repeating the union.

- [ ] **Step 5: Persist the override when creating a plan**

Change `crew/store.ts` to accept one optional value without introducing an options framework:

```ts
export function createPlan(
  cwd: string,
  prdPath: string,
  prompt?: string,
  dependencies?: DependencyMode,
): Plan {
  const now = new Date().toISOString();
  const plan: Plan = {
    prd: prdPath,
    ...(prompt ? { prompt } : {}),
    ...(dependencies ? { dependencies } : {}),
    created_at: now,
    updated_at: now,
    task_count: 0,
    completed_count: 0,
  };

  writeJson(path.join(getCrewDir(cwd), "plan.json"), plan);
  return plan;
}
```

Pass `params.dependencies` from the existing `store.createPlan(...)` call in `crew/handlers/plan.ts`.

- [ ] **Step 6: Apply the plan override in the existing config loader**

After merging default, user, and project config in `loadCrewConfig()`:

```ts
const planState = loadJson(path.join(crewDir, "plan.json"));
if (planState.dependencies === "strict" || planState.dependencies === "advisory") {
  merged.dependencies = planState.dependencies;
}
```

Keep the existing coordination runtime override after this block. Do not add a second configuration loader or readiness wrapper.

- [ ] **Step 7: Expose the action parameter in the TypeBox schema**

Add beside `autoWork`, `autonomous`, and `concurrency` in `index.ts`:

```ts
dependencies: Type.Optional(StringEnum(
  ["strict", "advisory"],
  { description: "Override dependency enforcement for this Crew run" },
)),
```

TypeBox rejects all other values; no handwritten duplicate validator is needed.

- [ ] **Step 8: Run focused tests and TypeScript**

Run:

```bash
npm test -- tests/crew/utils/config.test.ts tests/crew/plan-replan.test.ts
npm exec tsc -- --noEmit
```

Expected: focused tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit**

```bash
git add crew/types.ts crew/store.ts crew/utils/config.ts crew/handlers/plan.ts index.ts \
  tests/crew/utils/config.test.ts tests/crew/plan-replan.test.ts
git commit -m "feat: persist Crew dependency mode per run"
```

---

### Task 2: Make Work and Status Honor the Effective Mode

**Files:**
- Modify: `crew/handlers/work.ts:23-110`
- Modify: `crew/handlers/status.ts:19-191`
- Test: `tests/crew/graceful-shutdown.test.ts`
- Test: `tests/crew/auto-review.test.ts`
- Test: `tests/crew/status.test.ts`

**Interfaces:**
- Consumes: `CrewParams.dependencies?: DependencyMode` and `Plan.dependencies?: DependencyMode` from Task 1.
- Consumes: `loadCrewConfig()` with plan override precedence.
- Produces: `work({ dependencies })` updates the current plan before readiness is calculated.
- Produces: status text and details expose the effective mode and whether it comes from the plan override or configuration.
- Invariant: strict mode still passes every independent strict-ready task to the existing concurrency-limited worker pool.

- [ ] **Step 1: Add a failing strict-ready concurrency test**

In `tests/crew/graceful-shutdown.test.ts`, create one root, one independent task, and one dependent while project configuration remains advisory:

```ts
it("a strict work override runs independent ready tasks but not dependents", async () => {
  const store = await import("../../crew/store.js");
  const agents = await import("../../crew/agents.js");
  const workHandler = await import("../../crew/handlers/work.js");

  writeWorkerAgent(dirs.cwd);
  store.createPlan(dirs.cwd, "docs/PRD.md");
  const root = store.createTask(dirs.cwd, "Foundation", "Build foundation");
  const independent = store.createTask(dirs.cwd, "Independent docs", "Write docs");
  const dependent = store.createTask(dirs.cwd, "Consumer", "Use foundation", [root.id]);
  const spawnSpy = vi.spyOn(agents, "spawnAgents").mockResolvedValue([]);

  await workHandler.execute(
    { action: "work", dependencies: "strict", concurrency: 2 },
    createDirs(dirs.cwd),
    createMockContext(dirs.cwd),
    () => {},
  );

  expect(store.getPlan(dirs.cwd)?.dependencies).toBe("strict");
  const ids = (spawnSpy.mock.calls[0][0] as Array<{ taskId: string }>).map(t => t.taskId);
  expect(ids).toEqual([root.id, independent.id]);
  expect(ids).not.toContain(dependent.id);
});
```

- [ ] **Step 2: Add failing review-gate store tests**

Add one table-driven test to `tests/crew/auto-review.test.ts` proving downstream readiness follows predecessor state under strict selection:

```ts
it.each([
  ["todo", false],
  ["in_progress", false],
  ["blocked", false],
  ["done", true],
] as const)("dependent readiness waits while predecessor is %s", (status, expected) => {
  const { cwd } = createTempCrewDirs();
  store.createPlan(cwd, "PRD.md", undefined, "strict");
  const predecessor = store.createTask(cwd, "Foundation", "Spec");
  const dependent = store.createTask(cwd, "Consumer", "Spec", [predecessor.id]);
  store.updateTask(cwd, predecessor.id, { status });

  expect(store.getReadyTasks(cwd).map(t => t.id).includes(dependent.id)).toBe(expected);
});
```

This locks down the state transition used after `SHIP`, `NEEDS_WORK`, and `MAJOR_RETHINK` without duplicating the existing reviewer mocks.

- [ ] **Step 3: Add a failing status visibility test**

In `tests/crew/status.test.ts`, create a plan with a strict override and assert:

```ts
store.createPlan(tmpDir, "PRD.md", undefined, "strict");
const response = await statusHandler.execute(mockCtx);
const text = response.content[0].text;

expect(text).toContain("**Dependencies:** strict (plan override)");
expect(response.details.dependencies).toEqual({
  mode: "strict",
  source: "plan override",
});
```

Also retain an assertion that a plan without an override reports its configured mode with source `configuration`.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts tests/crew/status.test.ts
```

Expected: FAIL because `work` does not persist a call override and status does not expose dependency mode/source.

- [ ] **Step 5: Persist a work-call override before loading effective config**

At the beginning of `crew/handlers/work.ts`, load the plan before config and update only when requested:

```ts
const cwd = ctx.cwd ?? process.cwd();
let plan = store.getPlan(cwd);
if (!plan) {
  return result("No plan found. Create one first:\n\n  pi_messenger({ action: \"plan\" })\n  pi_messenger({ action: \"plan\", prd: \"path/to/PRD.md\" })", {
    mode: "work",
    error: "no_plan",
  });
}

if (params.dependencies && plan.dependencies !== params.dependencies) {
  plan = store.updatePlan(cwd, { dependencies: params.dependencies }) ?? plan;
}

const config = loadCrewConfig(getCrewDir(cwd));
const { autonomous, concurrency: concurrencyOverride } = params;
```

Remove the later duplicate plan lookup. Leave every existing readiness call unchanged: because each already consumes `config.dependencies`, the effective plan override now propagates to normal waves, autonomous waves, auto-work, coordination, and lobby-backed readiness paths through the shared config loader.

- [ ] **Step 6: Show effective dependency behavior in status**

After loading `plan` and effective `config` in `crew/handlers/status.ts`:

```ts
const dependencySource = plan.dependencies ? "plan override" : "configuration";
```

Add to the status header:

```ts
**Dependencies:** ${config.dependencies} (${dependencySource})
```

Add to result details:

```ts
dependencies: {
  mode: config.dependencies,
  source: dependencySource,
},
```

Do not add a new status section or formatter abstraction.

- [ ] **Step 7: Run focused tests and TypeScript**

Run:

```bash
npm test -- tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts tests/crew/status.test.ts
npm exec tsc -- --noEmit
```

Expected: focused tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit**

```bash
git add crew/handlers/work.ts crew/handlers/status.ts \
  tests/crew/graceful-shutdown.test.ts tests/crew/auto-review.test.ts tests/crew/status.test.ts
git commit -m "feat: enforce strict dependencies for Crew runs"
```

---

### Task 3: Correct the Superpowers Translation Policy and Documentation

**Files:**
- Modify: `crew/superpowers-policy.ts:6-12`
- Modify: `tests/crew/superpowers-policy.test.ts:26-59`
- Modify: `README.md` Superpowers integration and Crew workflow sections
- Modify: `CHANGELOG.md` current release section

**Interfaces:**
- Consumes: `dependencies: "strict"` plan/work override from Tasks 1-2.
- Produces: controlling-agent guidance that selects strict SDD execution, uses native Crew review, and permits only dependency-independent concurrency.
- Preserves: `SUPERPOWERS_OUTER_POLICY_MARKER`, active-state gating, child exclusion, and idempotence.

- [ ] **Step 1: Strengthen the policy test first**

Extend the active-state test in `tests/crew/superpowers-policy.test.ts`:

```ts
expect(result).toContain('dependencies: "strict"');
expect(result).toContain("native automatic review");
expect(result).toContain("dependency-independent");
expect(result).toContain("configured concurrency");
expect(result).toContain("do not create separate implementation/review meta-tasks");
expect(result).toContain("one safely ready task");
```

Keep the existing assertions for automatic authorization, sole dispatcher, Crew unavailability, unrelated Crew approval, inactive/fallback states, child exclusion, and idempotence.

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: FAIL because the current outer policy does not specify quality-first Crew execution semantics.

- [ ] **Step 3: Add one concise translation paragraph**

Add this paragraph to `OUTER_POLICY` after automatic Crew authorization:

```md
When translating SDD, select `dependencies: "strict"` for Crew planning and work, keep configured concurrency as the capacity ceiling, and let dependency-independent ready tasks run concurrently. Use Crew's native automatic review and repair; do not create separate implementation/review meta-tasks, globally chain independent work, set concurrency to 1 merely because SDD is active, or speculate across unfinished dependencies. One worker is correct when only one task is safely ready.
```

Do not add runtime detection, policy classes, templates, or configuration mutation.

- [ ] **Step 4: Run policy and lifecycle regression tests**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts \
  tests/crew/superpowers-extension.test.ts \
  tests/crew/superpowers-guard.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Update README and CHANGELOG**

In README's Superpowers integration list, state:

```md
- SDD-integrated Crew runs use strict dependency gates and native automatic task reviews. Configured concurrency remains available for dependency-independent ready tasks, but Crew does not manufacture work to keep every slot occupied.
```

In the Crew workflow description, clarify that dependents become ready only under the run's effective dependency mode and that an SDD run records `strict` in plan state.

Add one CHANGELOG bullet:

```md
- Corrected Superpowers SDD translation to use strict Crew dependency gates, native automatic reviews, and opportunistic concurrency without redundant review tasks.
```

- [ ] **Step 6: Run complete local verification**

Run:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check main...HEAD
```

Expected: all tests PASS, TypeScript exits 0, and diff check produces no output.

- [ ] **Step 7: Commit**

```bash
git add crew/superpowers-policy.ts tests/crew/superpowers-policy.test.ts README.md CHANGELOG.md
git commit -m "feat: translate SDD into quality-first Crew execution"
```

---

## Final Review and Release Gates

- Run primary LSP diagnostics on every changed TypeScript file before any build command.
- Run `lens_diagnostics` with `mode=all`; resolve all new blocking errors and explain unchanged pre-existing findings.
- Dispatch one independent read-only whole-branch review over `main...HEAD`; require no unresolved Critical or Important findings.
- Push the feature branch and open a pull request against `main`.
- Merge only after required GitHub check `test-and-typecheck` passes.
- Install the merged Git package and reload Pi.
- Run fresh tool-free behavioral acceptance for:
  - two independent strict-ready tasks may use configured concurrency;
  - a dependent waits for predecessor acceptance;
  - a linear plan correctly uses one worker;
  - native Crew review replaces review meta-tasks; and
  - unrelated non-SDD Crew still requires explicit authorization.
- Record sanitized acceptance evidence only if the repository's release process requires a tracked result; keep raw traces outside tracked paths.

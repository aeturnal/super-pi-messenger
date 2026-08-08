# Crew-Owned Parallel Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Crew compile sequentially presented Superpowers plans into validated parallel task graphs and repair malformed planner output without introducing a new scheduler.

**Architecture:** Build small pure graph helpers first. Update the three independent prompt and policy surfaces separately. Then add bounded output repair, reject invalid graphs, persist validated dependency indexes, and finally reconsider complete linear chains once.

**Tech Stack:** TypeScript, Node.js 24, Vitest, existing Crew planner agents, filesystem-backed Crew plan/task store.

## Global Constraints

- The exact Superpowers plan remains the source of requirements.
- Task numbering and document order do not create dependencies.
- Dependencies require a concrete file, symbol, schema, migration, or verified behavior and state that reason in the task description.
- Keep the existing `tasks-json` and persisted Task schemas.
- Keep strict dependency scheduling and the current automatic review lifecycle unchanged.
- Never delete graph edges automatically.
- Retry missing task format at most once.
- Reconsider a complete linear graph of four or more tasks at most once.
- Reject unresolved dependencies, self-dependencies, duplicate titles, and cycles before creating task files.
- Failed planning must not invite manual task creation or leave partial task files.
- Do not modify stock Superpowers files.
- Follow RED/GREEN TDD for every production change.

## Execution Graph

```text
Task 1 ── Task 2 ──────┐
                       ├── Task 7 ── Task 8 ── Task 9
Task 5 ── Task 6 ──────┘

Task 3 is independent.
Task 4 is independent.
```

- Task 1 resolves dependency references.
- Task 2 detects complete chains from resolved indexes.
- Task 3 updates the packaged planner instructions.
- Task 4 updates the outer controller policy.
- Task 5 updates the runtime first-pass prompt.
- Task 6 repairs missing task format.
- Task 7 rejects invalid graphs.
- Task 8 persists validated dependency mappings.
- Task 9 reconsiders complete chains once.

---

### Task 1: Resolve dependency titles and numbered aliases

**Files:**

- Create: `crew/utils/task-graph.ts`
- Create: `tests/crew/task-graph.test.ts`

**Interfaces:**

- Consumes: planner tasks shaped as `{ title: string; dependsOn: string[] }` and one dependency reference string.
- Produces:

```ts
export interface TaskGraphNode {
  title: string;
  dependsOn: string[];
}

export function resolveTaskReference(
  tasks: readonly TaskGraphNode[],
  reference: string,
): number | undefined;
```

- Exact task titles are case-insensitive and take priority over numbered aliases.
- `Task 1` and `task-1` resolve to zero-based position `0` when no exact title matches.
- Dependencies: none.

- [ ] **Step 1: Write failing reference-resolution tests**

Create `tests/crew/task-graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveTaskReference,
  type TaskGraphNode,
} from "../../crew/utils/task-graph.ts";

const node = (title: string, dependsOn: string[] = []): TaskGraphNode => ({
  title,
  dependsOn,
});

describe("resolveTaskReference", () => {
  const tasks = [node("Foundation"), node("Task 2"), node("Finish")];

  it("resolves exact titles case-insensitively", () => {
    expect(resolveTaskReference(tasks, "foundation")).toBe(0);
    expect(resolveTaskReference(tasks, "FINISH")).toBe(2);
  });

  it("prefers an exact title over a numbered alias", () => {
    expect(resolveTaskReference(tasks, "Task 2")).toBe(1);
  });

  it("resolves numbered aliases when no exact title matches", () => {
    const ordinary = [node("A"), node("B"), node("C")];
    expect(resolveTaskReference(ordinary, "Task 1")).toBe(0);
    expect(resolveTaskReference(ordinary, "task-3")).toBe(2);
  });

  it("returns undefined for blank, unknown, and out-of-range references", () => {
    expect(resolveTaskReference(tasks, "")).toBeUndefined();
    expect(resolveTaskReference(tasks, "Missing")).toBeUndefined();
    expect(resolveTaskReference(tasks, "Task 9")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm test -- tests/crew/task-graph.test.ts
```

Expected: FAIL because `crew/utils/task-graph.ts` does not exist.

- [ ] **Step 3: Implement only reference resolution**

Create `crew/utils/task-graph.ts`:

```ts
export interface TaskGraphNode {
  title: string;
  dependsOn: string[];
}

export function resolveTaskReference(
  tasks: readonly TaskGraphNode[],
  reference: string,
): number | undefined {
  const key = reference.trim().toLowerCase();
  if (!key) return undefined;

  const titleIndex = tasks.findIndex(task => task.title.trim().toLowerCase() === key);
  if (titleIndex >= 0) return titleIndex;

  const numbered = key.match(/^task(?: |-)(\d+)$/);
  if (!numbered) return undefined;
  const index = Number(numbered[1]) - 1;
  return index >= 0 && index < tasks.length ? index : undefined;
}
```

Do not add graph validation, cycle detection, chain detection, or persistence in this task.

- [ ] **Step 4: Run the focused test and TypeScript**

```bash
npm test -- tests/crew/task-graph.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit reference resolution**

```bash
git add crew/utils/task-graph.ts tests/crew/task-graph.test.ts
git commit -m "feat: resolve Crew task dependency references"
```

---

### Task 2: Detect complete linear chains

**Files:**

- Modify: `crew/utils/task-graph.ts`
- Modify: `tests/crew/task-graph.test.ts`

**Interfaces:**

- Consumes: a valid `readonly (readonly number[])[]` dependency-index graph from Task 1's module.
- Produces:

```ts
export function isCompleteTaskChain(
  dependencyIndexes: readonly (readonly number[])[],
): boolean;
```

- A chain is reconsidered only at four or more tasks.
- Dependencies: Task 1.

- [ ] **Step 1: Add failing chain-detection tests**

Append to `tests/crew/task-graph.test.ts`:

```ts
import {
  isCompleteTaskChain,
  resolveTaskReference,
  type TaskGraphNode,
} from "../../crew/utils/task-graph.ts";

describe("isCompleteTaskChain", () => {
  it("recognizes a four-task linear graph", () => {
    expect(isCompleteTaskChain([[], [0], [1], [2]])).toBe(true);
  });

  it("does not flag fewer than four tasks", () => {
    expect(isCompleteTaskChain([[], [0], [1]])).toBe(false);
  });

  it("does not flag parallel roots or branches", () => {
    expect(isCompleteTaskChain([[], [], [0, 1], [2]])).toBe(false);
    expect(isCompleteTaskChain([[], [0], [0], [1, 2]])).toBe(false);
  });

  it("recognizes a linear order with redundant transitive edges", () => {
    expect(isCompleteTaskChain([[], [0], [0, 1], [0, 1, 2]])).toBe(true);
  });
});
```

Merge the import with Task 1's existing import rather than creating two imports from the same module.

- [ ] **Step 2: Run the chain tests and verify RED**

```bash
npm test -- tests/crew/task-graph.test.ts -t "isCompleteTaskChain"
```

Expected: FAIL because `isCompleteTaskChain` is not exported.

- [ ] **Step 3: Implement topological-wave chain detection**

Append to `crew/utils/task-graph.ts`:

```ts
export function isCompleteTaskChain(
  dependencyIndexes: readonly (readonly number[])[],
): boolean {
  if (dependencyIndexes.length < 4) return false;

  const dependents = dependencyIndexes.map(() => [] as number[]);
  const indegree = dependencyIndexes.map(dependencies => dependencies.length);
  for (let consumer = 0; consumer < dependencyIndexes.length; consumer++) {
    for (const provider of dependencyIndexes[consumer]) {
      dependents[provider].push(consumer);
    }
  }

  let frontier = indegree
    .map((count, index) => ({ count, index }))
    .filter(entry => entry.count === 0)
    .map(entry => entry.index);
  let visited = 0;

  while (frontier.length > 0) {
    if (frontier.length !== 1) return false;
    visited += frontier.length;
    const next: number[] = [];
    for (const provider of frontier) {
      for (const consumer of dependents[provider]) {
        indegree[consumer]--;
        if (indegree[consumer] === 0) next.push(consumer);
      }
    }
    frontier = next;
  }

  return visited === dependencyIndexes.length;
}
```

Do not add invalid-graph error handling in this task; callers provide a valid index graph.

- [ ] **Step 4: Run graph-helper tests and TypeScript**

```bash
npm test -- tests/crew/task-graph.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit chain detection**

```bash
git add crew/utils/task-graph.ts tests/crew/task-graph.test.ts
git commit -m "feat: detect linear Crew task graphs"
```

---

### Task 3: Update packaged planner dependency instructions

**Files:**

- Modify: `crew/agents/crew-planner.md`
- Create: `tests/crew/planner-agent-contract.test.ts`

**Interfaces:**

- Consumes: the packaged `crew-planner` prompt.
- Produces: planner instructions that numbering is presentation order, dependencies need concrete reasons, and dependencies are strict gates.
- Dependencies: none.

- [ ] **Step 1: Create a failing planner-contract test**

Create `tests/crew/planner-agent-contract.test.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const plannerPath = path.join(process.cwd(), "crew", "agents", "crew-planner.md");

describe("crew planner parallel graph contract", () => {
  it("treats numbering as presentation and requires concrete dependency reasons", () => {
    const prompt = fs.readFileSync(plannerPath, "utf8");

    expect(prompt).toContain("Task numbering is presentation order only");
    expect(prompt).toContain("State the concrete dependency reason in the consumer task description");
    expect(prompt).toContain("file, symbol, schema, migration, or verified behavior");
    expect(prompt).toContain("Dependencies are strict execution gates");
    expect(prompt).not.toContain("Workers may start before dependencies complete");
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

```bash
npm test -- tests/crew/planner-agent-contract.test.ts
```

Expected: FAIL because the required wording is absent and the planner still says workers may start before dependencies complete.

- [ ] **Step 3: Tighten only the packaged planner prompt**

Under `### Parallel Execution` in `crew/agents/crew-planner.md`, add:

```md
- **Task numbering is presentation order only.** Never add a dependency merely because one numbered task appears earlier in the source plan or in your output.
- **Every dependency needs a concrete reason.** The consumer must need a file, symbol, schema, migration, or verified behavior produced by the provider. State the concrete dependency reason in the consumer task description.
```

Replace the first sentence under `### Dependency Descriptions` with:

```md
Dependencies are strict execution gates. Describe exactly what the provider must finish before the consumer can start:
```

Keep the existing file, export, signature, and interface-shape bullets.

- [ ] **Step 4: Run the planner-contract test**

```bash
npm test -- tests/crew/planner-agent-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the planner instructions**

```bash
git add crew/agents/crew-planner.md tests/crew/planner-agent-contract.test.ts
git commit -m "docs: clarify Crew planner dependency rules"
```

---

### Task 4: Update the outer Superpowers controller policy

**Files:**

- Modify: `crew/superpowers-policy.ts`
- Modify: `tests/crew/superpowers-policy.test.ts:65-86`

**Interfaces:**

- Consumes: `applySuperpowersOuterPolicy()` and its existing marker.
- Produces: controller guidance that Crew owns execution order and failed Crew planning must not fall back to manual serialized tasks.
- Dependencies: none.

- [ ] **Step 1: Add failing outer-policy assertions**

Extend the active-policy test in `tests/crew/superpowers-policy.test.ts`:

```ts
expect(result).toContain("Crew owns the execution graph");
expect(result).toContain("numbered task order is not dependency order");
expect(result).toContain("do not manually recreate or serialize Crew tasks");
expect(result).toContain("Report the failure so the user can retry or revise the plan");
```

- [ ] **Step 2: Run the policy test and verify RED**

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: FAIL because the outer policy does not yet assign graph ownership or forbid manual task fallback.

- [ ] **Step 3: Add the exact controller guidance**

In `crew/superpowers-policy.ts`, extend the authorized-Crew paragraph with:

```text
Crew owns the execution graph; numbered task order is not dependency order. Pass the exact plan to Crew and do not manually recreate or serialize Crew tasks when Crew planning fails. Report the failure so the user can retry or revise the plan.
```

Do not change the marker, activation condition, idempotency, or Crew-child suppression.

- [ ] **Step 4: Run all outer-policy tests**

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: PASS, including inactive, fallback, child-suppression, and idempotency cases.

- [ ] **Step 5: Commit the outer policy**

```bash
git add crew/superpowers-policy.ts tests/crew/superpowers-policy.test.ts
git commit -m "docs: assign execution graph ownership to Crew"
```

---

### Task 5: Update the runtime first-pass planner prompt

**Files:**

- Modify: `crew/handlers/plan.ts:612-652`
- Modify: `tests/crew/plan-replan.test.ts:150-230`

**Interfaces:**

- Consumes: private `buildFirstPassPrompt()` through `planHandler.execute()` and the existing mocked `spawnAgents()` test seam.
- Produces: first-pass runtime guidance that numbering is presentation only, dependencies need concrete reasons, and the critical path should be minimized.
- Dependencies: none.

- [ ] **Step 1: Add a failing runtime-prompt assertion**

In the existing `creates plan from prompt when no PRD exists` test in `tests/crew/plan-replan.test.ts`, extend the `plannerTask` assertions:

```ts
expect(plannerTask).toContain("Task numbering and document order are presentation only");
expect(plannerTask).toContain("concrete file, symbol, schema, migration, or verified behavior");
expect(plannerTask).toContain("Minimize the critical path");
```

- [ ] **Step 2: Run the prompt test and verify RED**

```bash
npm test -- tests/crew/plan-replan.test.ts -t "creates plan from prompt"
```

Expected: FAIL because `buildFirstPassPrompt()` does not contain the three rules.

- [ ] **Step 3: Add only the runtime planning rules**

In `buildFirstPassPrompt()`, immediately before the final output-format sentence, add:

```text
Task numbering and document order are presentation only, not dependencies.
Each dependency must name a concrete file, symbol, schema, migration, or verified behavior in the consumer description.
Minimize the critical path while preserving real dependencies.
```

Keep the existing four numbered report sections and `tasks-json` schema.

- [ ] **Step 4: Run prompt and re-plan tests**

```bash
npm test -- tests/crew/plan-replan.test.ts
```

Expected: PASS. Prompt-based, file-based, steering, transitive-pruning, and auto-work cases remain intact.

- [ ] **Step 5: Commit the runtime prompt**

```bash
git add crew/handlers/plan.ts tests/crew/plan-replan.test.ts
git commit -m "docs: clarify runtime Crew planning rules"
```

---

### Task 6: Repair missing planner task format once

**Files:**

- Modify: `crew/handlers/plan.ts:203-563,785-847`
- Create: `tests/crew/plan-output-repair.test.ts`

**Interfaces:**

- Consumes: existing `parseJsonTaskBlock()`, `parseTasksFromOutput()`, `spawnAgents()`, exact PRD content, and planner model selection.
- Produces:

```ts
function parsePlannerTasks(output: string): ParsedTask[];

function buildFormatRepairPrompt(
  prdPath: string,
  prdContent: string,
  previousOutput: string,
): string;
```

- Behavior: at most one `__planner_format_repair__` launch when both parsers return no tasks.
- Dependencies: Task 5, because both tasks modify `crew/handlers/plan.ts`.

- [ ] **Step 1: Create failing format-repair integration tests**

Create `tests/crew/plan-output-repair.test.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

vi.mock("../../crew/agents.ts", () => ({ spawnAgents: vi.fn() }));

const validOutput = `## 1. PRD Understanding Summary
Summary
## 2. Relevant Code/Docs/Resources Reviewed
Resources
## 3. Sequential Implementation Steps
Steps
## 4. Parallelized Task Graph
Graph
\`\`\`tasks-json
[{"title":"Task A","description":"Independent work","dependsOn":[]}]
\`\`\``;

const plannerResult = (output: string) => ({
  exitCode: 0,
  output,
  error: null,
  progress: { toolCallCount: 0, tokens: 0 },
});

describe("planner output repair", () => {
  let planHandler: typeof import("../../crew/handlers/plan.ts");
  let store: typeof import("../../crew/store.ts");
  let state: typeof import("../../crew/state.ts");
  let spawnAgents: ReturnType<typeof vi.fn>;
  let cwd: string;
  let ctx: any;

  beforeEach(async () => {
    vi.resetModules();
    planHandler = await import("../../crew/handlers/plan.ts");
    store = await import("../../crew/store.ts");
    state = await import("../../crew/state.ts");
    spawnAgents = (await import("../../crew/agents.ts")).spawnAgents as ReturnType<typeof vi.fn>;
    cwd = createTempCrewDirs().cwd;
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "docs", "PRD.md"), "# PRD\nBuild safely");
    fs.writeFileSync(
      path.join(cwd, ".pi", "messenger", "crew", "config.json"),
      JSON.stringify({ planning: { maxPasses: 1 } }),
    );
    ctx = { cwd, hasUI: false, ui: {} };
  });

  afterEach(() => {
    if (state.planningState.cwd) state.clearPlanningState(state.planningState.cwd);
  });

  it("repairs missing task format once and creates repaired tasks", async () => {
    spawnAgents
      .mockResolvedValueOnce([plannerResult("Analysis without task headings or JSON")])
      .mockResolvedValueOnce([plannerResult(validOutput)]);

    const response = await planHandler.execute(
      { action: "plan", prd: "docs/PRD.md", autoWork: false },
      ctx,
      "Lead",
    );

    expect(response.details.error).toBeUndefined();
    expect(store.getTasks(cwd).map(task => task.title)).toEqual(["Task A"]);
    expect(spawnAgents).toHaveBeenCalledTimes(2);
    expect(spawnAgents.mock.calls[1][0][0]).toMatchObject({
      agent: "crew-planner",
      taskId: "__planner_format_repair__",
    });
    expect(spawnAgents.mock.calls[1][0][0].task).toContain("FORMAT REPAIR");
    expect(spawnAgents.mock.calls[1][0][0].task).toContain("# PRD\nBuild safely");
  });

  it("fails safely when the one format repair remains unparseable", async () => {
    spawnAgents.mockResolvedValue([plannerResult("Still no task output")]);

    const response = await planHandler.execute(
      { action: "plan", prd: "docs/PRD.md", autoWork: false },
      ctx,
      "Lead",
    );

    expect(response.details).toMatchObject({ error: "invalid_planner_output" });
    expect(response.content[0].text).not.toContain("create tasks manually");
    expect(store.getTasks(cwd)).toEqual([]);
    expect(spawnAgents).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the repair tests and verify RED**

```bash
npm test -- tests/crew/plan-output-repair.test.ts
```

Expected: FAIL because planning currently returns after the first unparseable output and invites manual task creation.

- [ ] **Step 3: Add parser and repair-prompt helpers**

In `crew/handlers/plan.ts`, add:

```ts
function parsePlannerTasks(output: string): ParsedTask[] {
  return parseJsonTaskBlock(output) ?? parseTasksFromOutput(output);
}

function buildFormatRepairPrompt(
  prdPath: string,
  prdContent: string,
  previousOutput: string,
): string {
  return `FORMAT REPAIR

Return the same plan requirements as one valid tasks-json fenced block.
Do not add, remove, or reinterpret requirements.
Use full task titles in dependsOn and the existing task object schema.

## Source plan: ${prdPath}
${prdContent}

## Previous planner output
${previousOutput}`;
}
```

- [ ] **Step 4: Add one bounded format-repair call**

Replace direct parser selection with:

```ts
let tasks = parsePlannerTasks(lastPlannerOutput);
if (tasks.length === 0) {
  const [repairResult] = await spawnAgents([{
    agent: PLANNER_AGENT,
    task: buildFormatRepairPrompt(prdPath, prdContent, lastPlannerOutput),
    modelOverride: config.models?.planner ?? sessionModel,
    taskId: "__planner_format_repair__",
  }], cwd);

  if (isPlanningCancelled()) {
    return result("Planning cancelled.", { mode: "plan", error: "cancelled" });
  }
  if (repairResult.exitCode === 0) {
    lastPlannerOutput = repairResult.output;
    tasks = parsePlannerTasks(lastPlannerOutput);
  }
}
```

Immediately after the repair block, add:

```ts
if (tasks.length === 0) {
  store.setPlanSpec(cwd, lastPlannerOutput);
  finishPlanningRun(cwd, "failed", passesCompleted);
  reportProgress();
  logFeedEvent(cwd, agentName, "plan.failed", prdPath, "invalid planner output after format repair");
  notify(ctx, "Planning failed: planner task output remained invalid after one repair.", "error");
  return result(
    "Planning failed because the planner did not return a valid task list. Retry planning or revise the source plan.",
    { mode: "plan", error: "invalid_planner_output", prd: prdPath },
  );
}
```

Keep outline extraction after this repair so it uses the final `lastPlannerOutput`.

- [ ] **Step 5: Run format and re-plan tests**

```bash
npm test -- tests/crew/plan-output-repair.test.ts tests/crew/plan-replan.test.ts
```

Expected: PASS. Valid output uses one planner call; unparseable output uses at most two.

- [ ] **Step 6: Commit format repair**

```bash
git add crew/handlers/plan.ts tests/crew/plan-output-repair.test.ts
git commit -m "fix: repair malformed Crew planner output once"
```

---

### Task 7: Reject invalid planner task graphs

**Files:**

- Modify: `crew/utils/task-graph.ts`
- Modify: `crew/handlers/plan.ts:203-563`
- Modify: `tests/crew/task-graph.test.ts`
- Modify: `tests/crew/plan-output-repair.test.ts`
- Modify: `tests/crew/plan-replan.test.ts:250-330`

**Interfaces:**

- Consumes: `resolveTaskReference()` from Task 1 and parsed tasks from Task 6.
- Produces:

```ts
export type TaskGraphErrorCode =
  | "duplicate_title"
  | "unresolved_dependency"
  | "self_dependency"
  | "cycle";

export type TaskGraphValidation =
  | { valid: true; dependencyIndexes: number[][] }
  | { valid: false; code: TaskGraphErrorCode; message: string };

export function validateTaskGraph(
  tasks: readonly TaskGraphNode[],
): TaskGraphValidation;
```

- Behavior: invalid graphs fail before `store.createTask()`.
- Dependencies: Tasks 2 and 6.

- [ ] **Step 1: Add failing pure validation tests**

Add `validateTaskGraph` to the existing import, then append:

```ts
describe("validateTaskGraph", () => {
  it.each([
    {
      name: "duplicate titles",
      tasks: [node("Same"), node("same")],
      code: "duplicate_title",
    },
    {
      name: "an unresolved dependency",
      tasks: [node("A", ["Missing"])],
      code: "unresolved_dependency",
    },
    {
      name: "a self-dependency",
      tasks: [node("A", ["A"])],
      code: "self_dependency",
    },
    {
      name: "a cycle",
      tasks: [node("A", ["B"]), node("B", ["A"])],
      code: "cycle",
    },
  ])("rejects $name", ({ tasks, code }) => {
    expect(validateTaskGraph(tasks)).toMatchObject({ valid: false, code });
  });

  it("returns dependency indexes for a valid branch", () => {
    expect(validateTaskGraph([
      node("A"),
      node("B", ["A"]),
      node("C", ["Task 1"]),
      node("D", ["B", "C"]),
    ])).toEqual({
      valid: true,
      dependencyIndexes: [[], [0], [0], [1, 2]],
    });
  });
});
```

- [ ] **Step 2: Run pure tests and verify RED**

```bash
npm test -- tests/crew/task-graph.test.ts -t "validateTaskGraph"
```

Expected: FAIL because `validateTaskGraph` does not exist.

- [ ] **Step 3: Implement graph validation**

Append these types and implementation to `crew/utils/task-graph.ts`:

```ts
export type TaskGraphErrorCode =
  | "duplicate_title"
  | "unresolved_dependency"
  | "self_dependency"
  | "cycle";

export type TaskGraphValidation =
  | { valid: true; dependencyIndexes: number[][] }
  | { valid: false; code: TaskGraphErrorCode; message: string };

export function validateTaskGraph(
  tasks: readonly TaskGraphNode[],
): TaskGraphValidation {
  const titles = new Set<string>();
  for (const task of tasks) {
    const key = task.title.trim().toLowerCase();
    if (titles.has(key)) {
      return {
        valid: false,
        code: "duplicate_title",
        message: `Duplicate task title: ${task.title}`,
      };
    }
    titles.add(key);
  }

  const dependencyIndexes: number[][] = [];
  for (let index = 0; index < tasks.length; index++) {
    const resolved: number[] = [];
    for (const dependency of tasks[index].dependsOn) {
      const dependencyIndex = resolveTaskReference(tasks, dependency);
      if (dependencyIndex === undefined) {
        return {
          valid: false,
          code: "unresolved_dependency",
          message: `Unresolved dependency for ${tasks[index].title}: ${dependency}`,
        };
      }
      if (dependencyIndex === index) {
        return {
          valid: false,
          code: "self_dependency",
          message: `Task depends on itself: ${tasks[index].title}`,
        };
      }
      if (!resolved.includes(dependencyIndex)) resolved.push(dependencyIndex);
    }
    dependencyIndexes.push(resolved);
  }

  const dependents = tasks.map(() => [] as number[]);
  const indegree = dependencyIndexes.map(dependencies => dependencies.length);
  for (let consumer = 0; consumer < dependencyIndexes.length; consumer++) {
    for (const provider of dependencyIndexes[consumer]) {
      dependents[provider].push(consumer);
    }
  }

  const frontier = indegree
    .map((count, index) => ({ count, index }))
    .filter(entry => entry.count === 0)
    .map(entry => entry.index);
  let visited = 0;
  while (frontier.length > 0) {
    const provider = frontier.shift()!;
    visited++;
    for (const consumer of dependents[provider]) {
      indegree[consumer]--;
      if (indegree[consumer] === 0) frontier.push(consumer);
    }
  }

  if (visited !== tasks.length) {
    return {
      valid: false,
      code: "cycle",
      message: "Task dependencies contain a cycle",
    };
  }

  return { valid: true, dependencyIndexes };
}
```

Do not call `isCompleteTaskChain()` here; chain reconsideration remains Task 9.

- [ ] **Step 4: Add failing plan-handler rejection tests**

In `tests/crew/plan-output-repair.test.ts`, add:

```ts
const outputFor = (tasks: Array<{
  title: string;
  description: string;
  dependsOn: string[];
}>) => `## 1. PRD Understanding Summary
Summary
## 2. Relevant Code/Docs/Resources Reviewed
Resources
## 3. Sequential Implementation Steps
Steps
## 4. Parallelized Task Graph
Graph
\`\`\`tasks-json
${JSON.stringify(tasks)}
\`\`\``;

it.each([
  {
    name: "duplicate titles",
    tasks: [
      { title: "A", description: "First", dependsOn: [] },
      { title: "a", description: "Second", dependsOn: [] },
    ],
    code: "duplicate_title",
  },
  {
    name: "unresolved dependencies",
    tasks: [{ title: "A", description: "A", dependsOn: ["Missing"] }],
    code: "unresolved_dependency",
  },
  {
    name: "self-dependencies",
    tasks: [{ title: "A", description: "A", dependsOn: ["A"] }],
    code: "self_dependency",
  },
  {
    name: "cycles",
    tasks: [
      { title: "A", description: "A", dependsOn: ["B"] },
      { title: "B", description: "B", dependsOn: ["A"] },
    ],
    code: "cycle",
  },
])("rejects $name before task creation", async ({ tasks, code }) => {
  spawnAgents.mockResolvedValueOnce([plannerResult(outputFor(tasks))]);

  const response = await planHandler.execute(
    { action: "plan", prd: "docs/PRD.md", autoWork: false },
    ctx,
    "Lead",
  );

  expect(response.details).toMatchObject({
    error: "invalid_task_graph",
    graphError: code,
  });
  expect(store.getTasks(cwd)).toEqual([]);
});
```

Update the circular-reference case in `tests/crew/plan-replan.test.ts` to expect `invalid_task_graph`, `cycle`, and no tasks.

- [ ] **Step 5: Run integration tests and verify RED**

```bash
npm test -- tests/crew/plan-output-repair.test.ts tests/crew/plan-replan.test.ts
```

Expected: FAIL because `plan.ts` has not called the validator.

- [ ] **Step 6: Reject invalid graphs before persistence**

Import `validateTaskGraph`, then add this block after format repair and before outline/task persistence:

```ts
const graph = validateTaskGraph(tasks);
if (!graph.valid) {
  store.setPlanSpec(cwd, lastPlannerOutput);
  finishPlanningRun(cwd, "failed", passesCompleted);
  reportProgress();
  logFeedEvent(cwd, agentName, "plan.failed", prdPath, graph.message);
  notify(ctx, `Planning failed: ${graph.message}`, "error");
  return result(`Planning failed: ${graph.message}`, {
    mode: "plan",
    error: "invalid_task_graph",
    graphError: graph.code,
    prd: prdPath,
  });
}
```

Keep the valid `graph` binding in scope for Task 8.

- [ ] **Step 7: Run validator and planning tests**

```bash
npm test -- \
  tests/crew/task-graph.test.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts
npx tsc --noEmit
```

Expected: PASS. Invalid output creates no tasks.

- [ ] **Step 8: Commit invalid-graph rejection**

```bash
git add \
  crew/utils/task-graph.ts \
  crew/handlers/plan.ts \
  tests/crew/task-graph.test.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts
git commit -m "fix: reject invalid Crew task graphs"
```

---

### Task 8: Persist validated dependency mappings

**Files:**

- Modify: `crew/handlers/plan.ts:203-563`
- Modify: `tests/crew/plan-output-repair.test.ts`

**Interfaces:**

- Consumes: `graph.dependencyIndexes: number[][]` from Task 7.
- Produces: stored `depends_on` task IDs derived only from validated indexes.
- Dependencies: Task 7.

- [ ] **Step 1: Add a failing title-versus-alias collision test**

Add this case to `tests/crew/plan-output-repair.test.ts`:

```ts
it("preserves an exact numbered title instead of overwriting it with an alias", async () => {
  const collidingTasks = [
    { title: "Task 2", description: "Provider with a numbered title", dependsOn: [] },
    { title: "Consumer", description: "Uses the exact Task 2 title", dependsOn: ["Task 2"] },
  ];
  spawnAgents.mockResolvedValueOnce([plannerResult(outputFor(collidingTasks))]);

  const response = await planHandler.execute(
    { action: "plan", prd: "docs/PRD.md", autoWork: false },
    ctx,
    "Lead",
  );

  expect(response.details.error).toBeUndefined();
  const tasks = store.getTasks(cwd);
  const provider = tasks.find(task => task.title === "Task 2");
  const consumer = tasks.find(task => task.title === "Consumer");
  expect(provider).toBeDefined();
  expect(consumer).toBeDefined();
  expect(consumer?.depends_on).toEqual([provider?.id]);
});
```

- [ ] **Step 2: Run the collision test and verify RED**

```bash
npm test -- tests/crew/plan-output-repair.test.ts -t "numbered title"
```

Expected: FAIL because the existing `titleToId` loop overwrites the exact `Task 2` title with the second task's numbered alias and drops the resulting self-reference.

- [ ] **Step 3: Replace post-creation title lookup with validated indexes**

Replace the old creation and title-map loops with:

```ts
const createdTasks: Array<{ id: string; title: string; dependencyIndexes: number[] }> = [];

for (let index = 0; index < tasks.length; index++) {
  const task = tasks[index];
  const role = teamStore.canonicalRoleForTask(cwd, task.role);
  const riskLabels = teamStore.normalizeRiskLabels(task.riskLabels);
  const approval = teamStore.approvalForTask(cwd, role, riskLabels);
  const created = store.createTask(cwd, task.title, task.description, undefined, {
    ...(role ? { role } : {}),
    ...(riskLabels && riskLabels.length > 0 ? { risk_labels: riskLabels } : {}),
    ...(approval ? { approval } : {}),
    ...(task.skills && task.skills.length > 0 ? { skills: task.skills } : {}),
  });
  createdTasks.push({
    id: created.id,
    title: task.title,
    dependencyIndexes: graph.dependencyIndexes[index],
  });
}

for (const task of createdTasks) {
  const resolvedDeps = task.dependencyIndexes.map(index => createdTasks[index].id);
  if (resolvedDeps.length > 0) {
    store.updateTask(cwd, task.id, { depends_on: resolvedDeps });
  }
}
```

Remove the old `titleToId` map and silent `if (depId)` branch. Keep `pruneTransitiveDeps()`.

- [ ] **Step 4: Run mapping, pruning, and strict-readiness tests**

```bash
npm test -- \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/team-work.test.ts
npx tsc --noEmit
```

Expected: PASS. Exact titles win over aliases, transitive dependencies remain pruned, and strict readiness remains unchanged.

- [ ] **Step 5: Commit dependency persistence**

```bash
git add crew/handlers/plan.ts tests/crew/plan-output-repair.test.ts
git commit -m "fix: persist validated Crew task dependencies"
```

---

### Task 9: Reconsider complete linear graphs once

**Files:**

- Modify: `crew/handlers/plan.ts:203-563`
- Modify: `tests/crew/plan-output-repair.test.ts`

**Interfaces:**

- Consumes: `isCompleteTaskChain()` from Task 2, validated tasks and indexes from Tasks 7 and 8, and `parsePlannerTasks()` from Task 6.
- Produces:

```ts
function buildLinearGraphRepairPrompt(
  prdPath: string,
  prdContent: string,
  previousOutput: string,
): string;
```

- Behavior: make at most one `__planner_graph_repair__` launch for a valid complete chain of four or more tasks; accept a valid retained chain; reject malformed or invalid repaired output before task creation.
- Dependencies: Task 8. Task 2 is already included transitively through Tasks 7 and 8.

- [ ] **Step 1: Add failing complete-chain integration tests**

Add these cases to `tests/crew/plan-output-repair.test.ts`:

```ts
const linearTasks = [
  { title: "A", description: "Foundation", dependsOn: [] },
  { title: "B", description: "Needs A's exported type", dependsOn: ["A"] },
  { title: "C", description: "Needs B's parser", dependsOn: ["B"] },
  { title: "D", description: "Needs C's result", dependsOn: ["C"] },
];

it("reconsiders a complete linear graph and accepts parallel branches", async () => {
  const branchedTasks = [
    linearTasks[0],
    linearTasks[1],
    { title: "C", description: "Independent renderer", dependsOn: [] },
    { title: "D", description: "Consumes B and C", dependsOn: ["B", "C"] },
  ];
  spawnAgents
    .mockResolvedValueOnce([plannerResult(outputFor(linearTasks))])
    .mockResolvedValueOnce([plannerResult(outputFor(branchedTasks))]);

  const response = await planHandler.execute(
    { action: "plan", prd: "docs/PRD.md", autoWork: false },
    ctx,
    "Lead",
  );

  expect(response.details.error).toBeUndefined();
  expect(spawnAgents.mock.calls[1][0][0]).toMatchObject({
    taskId: "__planner_graph_repair__",
  });
  const tasks = store.getTasks(cwd);
  expect(tasks.filter(task => task.depends_on.length === 0).map(task => task.title))
    .toEqual(["A", "C"]);
});

it("accepts a still-linear graph after one reconsideration", async () => {
  spawnAgents.mockResolvedValue([plannerResult(outputFor(linearTasks))]);

  const response = await planHandler.execute(
    { action: "plan", prd: "docs/PRD.md", autoWork: false },
    ctx,
    "Lead",
  );

  expect(response.details.error).toBeUndefined();
  expect(spawnAgents).toHaveBeenCalledTimes(2);
  expect(store.getTasks(cwd)).toHaveLength(4);
});

it("rejects invalid graph reconsideration output without creating tasks", async () => {
  spawnAgents
    .mockResolvedValueOnce([plannerResult(outputFor(linearTasks))])
    .mockResolvedValueOnce([plannerResult("Invalid repaired output")]);

  const response = await planHandler.execute(
    { action: "plan", prd: "docs/PRD.md", autoWork: false },
    ctx,
    "Lead",
  );

  expect(response.details.error).toBe("invalid_task_graph");
  expect(store.getTasks(cwd)).toEqual([]);
});
```

- [ ] **Step 2: Run reconsideration tests and verify RED**

```bash
npm test -- tests/crew/plan-output-repair.test.ts -t "reconsider|linear graph"
```

Expected: FAIL because valid chains currently create tasks after one planner call.

- [ ] **Step 3: Add the reconsideration prompt**

Add:

```ts
function buildLinearGraphRepairPrompt(
  prdPath: string,
  prdContent: string,
  previousOutput: string,
): string {
  return `GRAPH RECONSIDERATION

The task graph is one complete chain of four or more tasks.
Task numbering and document order are not dependency reasons.
Remove unsupported edges and expose independent branches where safe.
Retain a dependency only when the consumer needs a concrete file, symbol,
schema, migration, or verified behavior from the provider.
State each retained dependency reason in the consumer description.
If every edge is necessary, return the justified chain unchanged.
Return the complete plan with one valid tasks-json fenced block.
Do not add, remove, or reinterpret source requirements.

## Source plan: ${prdPath}
${prdContent}

## Previous planner output
${previousOutput}`;
}
```

- [ ] **Step 4: Launch one repair and revalidate it**

Add `isCompleteTaskChain` to the task-graph import. Change Task 7's valid `graph` binding from `const` to `let`, then insert before task creation:

```ts
if (isCompleteTaskChain(graph.dependencyIndexes)) {
  const [repairResult] = await spawnAgents([{
    agent: PLANNER_AGENT,
    task: buildLinearGraphRepairPrompt(prdPath, prdContent, lastPlannerOutput),
    modelOverride: config.models?.planner ?? sessionModel,
    taskId: "__planner_graph_repair__",
  }], cwd);

  if (isPlanningCancelled()) {
    return result("Planning cancelled.", { mode: "plan", error: "cancelled" });
  }

  if (repairResult.exitCode === 0) {
    lastPlannerOutput = repairResult.output;
    tasks = parsePlannerTasks(lastPlannerOutput);
    graph = validateTaskGraph(tasks);
  }

  if (repairResult.exitCode !== 0 || tasks.length === 0 || !graph.valid) {
    const graphError = graph.valid ? "invalid_planner_output" : graph.code;
    store.setPlanSpec(cwd, lastPlannerOutput);
    finishPlanningRun(cwd, "failed", passesCompleted);
    reportProgress();
    logFeedEvent(cwd, agentName, "plan.failed", prdPath, "invalid graph reconsideration output");
    notify(ctx, "Planning failed: graph reconsideration returned invalid tasks.", "error");
    return result("Planning failed: graph reconsideration returned invalid tasks.", {
      mode: "plan",
      error: "invalid_task_graph",
      graphError,
      prd: prdPath,
    });
  }
}
```

Do not repeat reconsideration when the repaired graph is still linear. Keep outline extraction after this block so it uses the final output.

- [ ] **Step 5: Run planning and strict-scheduling tests**

```bash
npm test -- \
  tests/crew/task-graph.test.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/team-work.test.ts \
  tests/crew/worker-coordination.test.ts
npx tsc --noEmit
```

Expected: PASS. Every complete chain receives exactly one reconsideration; valid retained chains are accepted; repaired branches remain parallel-ready; invalid repair output creates no tasks.

- [ ] **Step 6: Commit linear-graph reconsideration**

```bash
git add crew/handlers/plan.ts tests/crew/plan-output-repair.test.ts
git commit -m "fix: reconsider linear Crew task graphs"
```

---

## Final Verification

After all nine graph-plan task commits are present, run:

```bash
npm test -- \
  tests/crew/task-graph.test.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts \
  tests/crew/superpowers-policy.test.ts \
  tests/crew/planner-agent-contract.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/team-work.test.ts \
  tests/crew/team-task-approval.test.ts \
  tests/crew/auto-review.test.ts
npx tsc --noEmit
git diff --check HEAD~9..HEAD
```

Then run the complete suite:

```bash
npm test
```

Expected: all tests and TypeScript checks pass. Existing valid plans create tasks normally; malformed or invalid graphs fail without partial tasks; independent ready tasks remain eligible for the existing concurrent scheduler.

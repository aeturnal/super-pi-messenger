# Crew-Owned Parallel Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Crew compile sequentially presented Superpowers plans into validated parallel task graphs and repair malformed planner output without introducing a new scheduler.

**Architecture:** Add one pure task-graph validator for title resolution, cycles, and complete-chain detection. Strengthen planner and controller policy text, then add two bounded planner retries before any task files are created: one for missing task format and one for a valid but fully linear graph of four or more tasks.

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
Task 1 ───────────────┐
                      ├── Task 4 ── Task 5
Task 3 ───────────────┘

Task 2 is independent and may run beside Tasks 1 and 3.
```

Task 1 creates the pure graph interface. Task 3 adds format repair in `plan.ts`. Task 4 consumes both and enforces structural validity. Task 5 adds bounded linear-graph reconsideration. Task 2 changes only planner/policy instructions and their tests.

---

### Task 1: Pure task-graph validation

**Files:**

- Create: `crew/utils/task-graph.ts`
- Create: `tests/crew/task-graph.test.ts`

**Interfaces:**

- Consumes: planner tasks shaped as `{ title: string; dependsOn: string[] }`.
- Produces:

```ts
export interface TaskGraphNode {
  title: string;
  dependsOn: string[];
}

export type TaskGraphErrorCode =
  | "duplicate_title"
  | "unresolved_dependency"
  | "self_dependency"
  | "cycle";

export type TaskGraphValidation =
  | {
      valid: true;
      dependencyIndexes: number[][];
      completeChain: boolean;
    }
  | {
      valid: false;
      code: TaskGraphErrorCode;
      message: string;
    };

export function validateTaskGraph(
  tasks: readonly TaskGraphNode[],
): TaskGraphValidation;
```

- Dependency aliases `Task 1` and `task-1` resolve to the corresponding task position for markdown fallback compatibility.
- Dependencies: none.

- [ ] **Step 1: Write failing unit tests for valid branches and invalid graphs**

Create `tests/crew/task-graph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateTaskGraph } from "../../crew/utils/task-graph.ts";

const node = (title: string, dependsOn: string[] = []) => ({ title, dependsOn });

describe("validateTaskGraph", () => {
  it("resolves title and numbered aliases into dependency indexes", () => {
    const result = validateTaskGraph([
      node("Foundation"),
      node("Branch A", ["Foundation"]),
      node("Branch B", ["Task 1"]),
      node("Finish", ["task-2", "Branch B"]),
    ]);

    expect(result).toEqual({
      valid: true,
      dependencyIndexes: [[], [0], [0], [1, 2]],
      completeChain: false,
    });
  });

  it("identifies a complete chain only at four or more tasks", () => {
    expect(validateTaskGraph([
      node("A"),
      node("B", ["A"]),
      node("C", ["B"]),
      node("D", ["C"]),
    ])).toMatchObject({ valid: true, completeChain: true });

    expect(validateTaskGraph([
      node("A"),
      node("B", ["A"]),
      node("C", ["B"]),
    ])).toMatchObject({ valid: true, completeChain: false });
  });

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
});
```

- [ ] **Step 2: Run the new unit test and verify RED**

Run:

```bash
npm test -- tests/crew/task-graph.test.ts
```

Expected: FAIL because `crew/utils/task-graph.ts` does not exist.

- [ ] **Step 3: Implement the pure validator**

Create `crew/utils/task-graph.ts`:

```ts
export interface TaskGraphNode {
  title: string;
  dependsOn: string[];
}

export type TaskGraphErrorCode =
  | "duplicate_title"
  | "unresolved_dependency"
  | "self_dependency"
  | "cycle";

export type TaskGraphValidation =
  | {
      valid: true;
      dependencyIndexes: number[][];
      completeChain: boolean;
    }
  | {
      valid: false;
      code: TaskGraphErrorCode;
      message: string;
    };

export function validateTaskGraph(
  tasks: readonly TaskGraphNode[],
): TaskGraphValidation {
  const titleIndexes = new Map<string, number>();

  for (let index = 0; index < tasks.length; index++) {
    const titleKey = tasks[index].title.trim().toLowerCase();
    if (titleIndexes.has(titleKey)) {
      return {
        valid: false,
        code: "duplicate_title",
        message: `Duplicate task title: ${tasks[index].title}`,
      };
    }
    titleIndexes.set(titleKey, index);
  }

  const resolveDependency = (dependency: string): number | undefined => {
    const key = dependency.trim().toLowerCase();
    const titleIndex = titleIndexes.get(key);
    if (titleIndex !== undefined) return titleIndex;
    const numbered = key.match(/^task(?: |-)(\d+)$/);
    if (!numbered) return undefined;
    const index = Number(numbered[1]) - 1;
    return index >= 0 && index < tasks.length ? index : undefined;
  };

  const dependencyIndexes: number[][] = [];
  for (let index = 0; index < tasks.length; index++) {
    const resolved: number[] = [];
    for (const dependency of tasks[index].dependsOn) {
      const dependencyIndex = resolveDependency(dependency);
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

  let frontier = indegree
    .map((count, index) => ({ count, index }))
    .filter(entry => entry.count === 0)
    .map(entry => entry.index);
  let visited = 0;
  let everyWaveHasOneTask = true;

  while (frontier.length > 0) {
    if (frontier.length !== 1) everyWaveHasOneTask = false;
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

  if (visited !== tasks.length) {
    return {
      valid: false,
      code: "cycle",
      message: "Task dependencies contain a cycle",
    };
  }

  return {
    valid: true,
    dependencyIndexes,
    completeChain: tasks.length >= 4 && everyWaveHasOneTask,
  };
}
```

- [ ] **Step 4: Run the validator tests and TypeScript**

Run:

```bash
npm test -- tests/crew/task-graph.test.ts
npx tsc --noEmit
```

Expected: PASS. The helper has no filesystem, store, planner, or scheduler dependencies.

- [ ] **Step 5: Commit the validator**

```bash
git add crew/utils/task-graph.ts tests/crew/task-graph.test.ts
git commit -m "feat: validate Crew task dependency graphs"
```

---

### Task 2: State Crew graph ownership in planner and Superpowers policy

**Files:**

- Modify: `crew/agents/crew-planner.md`
- Modify: `crew/superpowers-policy.ts`
- Modify: `tests/crew/superpowers-policy.test.ts:65-86`
- Create: `tests/crew/planner-agent-contract.test.ts`

**Interfaces:**

- Consumes: the existing outer policy marker and packaged planner prompt.
- Produces: explicit prompt contracts that task numbering is not dependency order, dependencies need concrete reasons, and the controller must not manually recreate or serialize Crew tasks.
- Dependencies: none.

- [ ] **Step 1: Add failing prompt-contract tests**

In `tests/crew/superpowers-policy.test.ts`, extend the active-policy test:

```ts
expect(result).toContain("Crew owns the execution graph");
expect(result).toContain("numbered task order is not dependency order");
expect(result).toContain("do not manually recreate or serialize Crew tasks");
```

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
    expect(prompt).not.toContain("Workers may start before dependencies complete");
  });
});
```

- [ ] **Step 2: Run policy tests and verify RED**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/planner-agent-contract.test.ts
```

Expected: FAIL because neither packaged policy contains the new execution-graph language and the planner still says workers may start before dependencies complete.

- [ ] **Step 3: Tighten the planner's dependency language**

In `crew/agents/crew-planner.md`, add these bullets under `### Parallel Execution`:

```md
- **Task numbering is presentation order only.** Never add a dependency merely because one numbered task appears earlier in the source plan or in your output.
- **Every dependency needs a concrete reason.** The consumer must need a file, symbol, schema, migration, or verified behavior produced by the provider. State the concrete dependency reason in the consumer task description.
```

Replace the sentence under `### Dependency Descriptions` that says workers may start before dependencies complete with:

```md
Dependencies are strict execution gates. Describe exactly what the provider must finish before the consumer can start:
```

Keep the existing file, export, signature, and interface-shape bullets because they make the reason concrete.

- [ ] **Step 4: Tighten the controller's Superpowers compatibility policy**

In `crew/superpowers-policy.ts`, extend the authorized-Crew paragraph with these exact sentences:

```text
Crew owns the execution graph; numbered task order is not dependency order. Pass the exact plan to Crew and do not manually recreate or serialize Crew tasks when Crew planning fails. Report the failure so the user can retry or revise the plan.
```

Do not change the marker or child suppression behavior.

- [ ] **Step 5: Run the focused policy tests**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/planner-agent-contract.test.ts
```

Expected: PASS. The controller still automatically authorizes Crew only under the existing Superpowers condition, and Crew child prompts still suppress the outer policy.

- [ ] **Step 6: Commit the prompt contracts**

```bash
git add \
  crew/agents/crew-planner.md \
  crew/superpowers-policy.ts \
  tests/crew/superpowers-policy.test.ts \
  tests/crew/planner-agent-contract.test.ts
git commit -m "docs: make Crew own parallel task ordering"
```

---

### Task 3: Repair missing planner task format once

**Files:**

- Modify: `crew/handlers/plan.ts:605-652,203-563`
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

- Behavior: at most one `__planner_format_repair__` child launch when both parsers return no tasks; repaired output replaces `lastPlannerOutput` before outline and task creation.
- Dependencies: none.

- [ ] **Step 1: Create failing format-repair integration tests**

Create `tests/crew/plan-output-repair.test.ts` with the standard mocked planner setup used in `tests/crew/plan-replan.test.ts`. Include these helpers and cases:

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

describe("planner output format repair", () => {
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

  it("repairs missing tasks-json once and creates repaired tasks", async () => {
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

  it("fails safely when the single format repair is still unparseable", async () => {
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

- [ ] **Step 2: Run the repair test and verify RED**

Run:

```bash
npm test -- tests/crew/plan-output-repair.test.ts
```

Expected: FAIL because planning currently returns after the first unparseable output and tells the caller to create tasks manually.

- [ ] **Step 3: Add exact parser and format-repair prompt helpers**

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

Also strengthen `buildFirstPassPrompt()` immediately before its final output-format sentence:

```text
Task numbering and document order are presentation only, not dependencies.
Each dependency must name a concrete file, symbol, schema, migration, or verified behavior in the consumer description.
Minimize the critical path while preserving real dependencies.
```

Keep the four numbered report sections for compatibility.

- [ ] **Step 4: Add the one-shot format repair before task creation**

Change `const tasks` to a mutable binding. When it is empty, launch exactly one planner repair:

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

After this block, replace the old no-task result with a safe failure:

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

Build `sections`, `outlineContent`, and `setPlanningOutline()` from the final `lastPlannerOutput` after repair, not the original malformed output. Do not create a third planner call.

- [ ] **Step 5: Run focused planning tests**

Run:

```bash
npm test -- tests/crew/plan-output-repair.test.ts tests/crew/plan-replan.test.ts
```

Expected: PASS. Existing valid output still uses one planner call; only unparseable output uses the second call.

- [ ] **Step 6: Commit format repair**

```bash
git add crew/handlers/plan.ts tests/crew/plan-output-repair.test.ts
git commit -m "fix: repair malformed Crew planner output once"
```

---

### Task 4: Reject invalid task graphs and map dependencies losslessly

**Files:**

- Modify: `crew/handlers/plan.ts:203-563`
- Modify: `tests/crew/plan-output-repair.test.ts`
- Modify: `tests/crew/plan-replan.test.ts:250-330`
- Test: `tests/crew/task-graph.test.ts`

**Interfaces:**

- Consumes: `validateTaskGraph()` and `TaskGraphValidation` from Task 1; `parsePlannerTasks()` from Task 3.
- Produces: a validated `graph.dependencyIndexes: number[][]` used for title-to-task-ID mapping before task files are created.
- Behavior: reject duplicate titles, unresolved dependencies, self-dependencies, and cycles without creating task files; stop silently dropping unknown dependency names.
- Dependencies: Tasks 1 and 3.

- [ ] **Step 1: Add failing structural-validation tests**

Extend `tests/crew/plan-output-repair.test.ts` with a helper that emits tasks-json and these cases:

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

Update the existing circular-reference test in `tests/crew/plan-replan.test.ts` to expect `{ error: "invalid_task_graph", graphError: "cycle" }` and no created tasks.

- [ ] **Step 2: Run structural tests and verify RED**

Run:

```bash
npm test -- tests/crew/task-graph.test.ts tests/crew/plan-output-repair.test.ts tests/crew/plan-replan.test.ts
```

Expected: FAIL because `plan.ts` still silently drops unresolved dependencies, overwrites duplicate title aliases, and accepts cycles.

- [ ] **Step 3: Validate parsed tasks before creating task files**

Import the validator:

```ts
import { validateTaskGraph } from "../utils/task-graph.ts";
```

Immediately after format repair produces non-empty `tasks`, validate it:

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

Place this block before `store.createTask()` is called. Keep `graph` in scope for dependency mapping.

- [ ] **Step 4: Use validated indexes instead of silently resolving titles after creation**

Replace the old `titleToId` mapping loops with:

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

Remove the old `titleToId` map and silent `if (depId)` drop. Keep `pruneTransitiveDeps()` after writing validated dependencies.

- [ ] **Step 5: Run structural, mapping, and strict-dependency tests**

Run:

```bash
npm test -- \
  tests/crew/task-graph.test.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts \
  tests/crew/task-actions.test.ts \
  tests/crew/team-work.test.ts
npx tsc --noEmit
```

Expected: PASS. Invalid graphs create no tasks, valid title and numbered aliases map to the correct task IDs, transitive pruning remains intact, and strict task readiness is unchanged.

- [ ] **Step 6: Commit structural graph enforcement**

```bash
git add \
  crew/handlers/plan.ts \
  tests/crew/plan-output-repair.test.ts \
  tests/crew/plan-replan.test.ts
git commit -m "fix: reject invalid Crew task graphs"
```

---

### Task 5: Reconsider complete linear graphs once

**Files:**

- Modify: `crew/handlers/plan.ts:203-563`
- Modify: `tests/crew/plan-output-repair.test.ts`

**Interfaces:**

- Consumes: the validated `graph.completeChain: boolean` and `graph.dependencyIndexes` from Tasks 1 and 4; `parsePlannerTasks()` from Task 3.
- Produces:

```ts
function buildLinearGraphRepairPrompt(
  prdPath: string,
  prdContent: string,
  previousOutput: string,
): string;
```

- Behavior: make at most one `__planner_graph_repair__` launch for a valid complete chain of four or more tasks; accept a valid retained chain after reconsideration; reject malformed or invalid repaired output before task creation.
- Dependencies: Task 4.

- [ ] **Step 1: Add failing complete-chain reconsideration tests**

In `tests/crew/plan-output-repair.test.ts`, add:

```ts
const linearTasks = [
  { title: "A", description: "Foundation", dependsOn: [] },
  { title: "B", description: "Needs A's exported type", dependsOn: ["A"] },
  { title: "C", description: "Needs B's parser", dependsOn: ["B"] },
  { title: "D", description: "Needs C's result", dependsOn: ["C"] },
];

it("reconsiders a complete four-task chain and accepts parallel branches", async () => {
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
  expect(spawnAgents.mock.calls[1][0][0].task).toContain("GRAPH RECONSIDERATION");
  const tasks = store.getTasks(cwd);
  const roots = tasks.filter(task => task.depends_on.length === 0).map(task => task.title);
  expect(roots).toEqual(["A", "C"]);
});

it("accepts a still-linear graph after exactly one required reconsideration", async () => {
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

it("fails without tasks when graph reconsideration returns invalid output", async () => {
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

Run:

```bash
npm test -- tests/crew/plan-output-repair.test.ts -t "reconsider|still-linear|reconsideration returns invalid"
```

Expected: FAIL because a valid complete chain currently creates tasks after the first planner call and never launches `__planner_graph_repair__`.

- [ ] **Step 3: Add the graph-reconsideration prompt**

In `crew/handlers/plan.ts`, add:

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

- [ ] **Step 4: Reconsider once and revalidate before task creation**

Change Task 4's `const graph` binding to `let graph`, then insert this block after initial graph validation and before `store.createTask()`:

```ts
if (graph.completeChain) {
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

Do not loop when the repaired graph is still a complete chain. One valid reconsideration satisfies the requirement. Keep `extractPlanSections()`, outline construction, and `setPlanningOutline()` after this block so they use the final reconsidered `lastPlannerOutput`.

- [ ] **Step 5: Run planning and strict-scheduling tests**

Run:

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

Expected: PASS. Every complete chain receives exactly one reconsideration, valid retained chains are accepted, repaired branches remain parallel-ready, invalid repair output creates no tasks, and strict scheduling is unchanged.

- [ ] **Step 6: Commit linear-graph reconsideration**

```bash
git add crew/handlers/plan.ts tests/crew/plan-output-repair.test.ts
git commit -m "fix: reconsider linear Crew task graphs"
```

---

## Final Verification

After all five task commits are present, run:

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
git diff --check HEAD~5..HEAD
```

Then run the complete suite:

```bash
npm test
```

Expected: all tests and TypeScript checks pass. Existing valid plans still create tasks normally; malformed or invalid graphs fail without partial tasks; independent ready tasks remain eligible for the existing concurrent scheduler.

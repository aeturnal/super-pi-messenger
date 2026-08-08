import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createGitWorktreeFixture, type GitWorktreeFixture } from "../helpers/git-worktree.ts";
import { resolveWorkspace } from "../../crew/workspace.ts";

vi.mock("../../crew/agents.ts", () => ({
  spawnAgents: vi.fn(),
}));

const plannerOutput = `## 1. PRD Understanding Summary
Summary
## 2. Relevant Code/Docs/Resources Reviewed
Resources
## 3. Sequential Implementation Steps
Steps
## 4. Parallelized Task Graph
Graph
\`\`\`tasks-json
[{"title":"Task A","description":"Do A","dependsOn":[]}]
\`\`\``;

const plannerResult = {
  exitCode: 0,
  output: plannerOutput,
  error: null,
  progress: { toolCallCount: 0, tokens: 0 },
};

describe("plan workspace handoff", () => {
  let planHandler: typeof import("../../crew/handlers/plan.ts");
  let spawnAgents: ReturnType<typeof vi.fn>;
  let store: typeof import("../../crew/store.ts");
  let state: typeof import("../../crew/state.ts");
  let fx: GitWorktreeFixture;

  beforeEach(async () => {
    vi.resetModules();
    planHandler = await import("../../crew/handlers/plan.ts");
    store = await import("../../crew/store.ts");
    state = await import("../../crew/state.ts");
    spawnAgents = (await import("../../crew/agents.ts")).spawnAgents as ReturnType<typeof vi.fn>;
    spawnAgents.mockResolvedValue([plannerResult]);

    fx = createGitWorktreeFixture();
    fs.mkdirSync(path.join(fx.worktree, "docs", "superpowers", "plans"), { recursive: true });
    fs.writeFileSync(
      path.join(fx.worktree, "docs", "superpowers", "plans", "example.md"),
      "# Exact plan\n\nDistinctive plan content for workspace planning.\n",
    );
  });

  afterEach(() => {
    if (state.planningState.cwd) state.clearPlanningState(state.planningState.cwd);
    fx.cleanup();
  });

  function context(cwd = fx.worktree) {
    return { cwd, hasUI: false, ui: {} } as any;
  }

  function expectNoPlanningStarted(cwd = fx.worktree) {
    expect(spawnAgents).not.toHaveBeenCalled();
    expect(store.getTasks(cwd)).toEqual([]);
  }

  it("uses the canonical workspace for an exact relative plan handoff", async () => {
    const r = await planHandler.execute(
      {
        action: "plan",
        prd: "docs/superpowers/plans/example.md",
        workspace: fx.worktree,
        autoWork: false,
      },
      context(),
      "agent",
    );

    const workspace = fs.realpathSync(fx.worktree);
    const identity = resolveWorkspace(fx.worktree, fx.worktree);
    const planJson = JSON.parse(fs.readFileSync(path.join(store.getCrewDir(fx.worktree), "plan.json"), "utf-8"));
    expect(r.details?.error).toBeUndefined();
    expect(planJson.workspace).toEqual(identity);
    expect(spawnAgents.mock.calls[0][0][0].task).toContain("PRD: docs/superpowers/plans/example.md");
    expect(spawnAgents.mock.calls[0][0][0].task).toContain("Distinctive plan content for workspace planning.");
    expect(spawnAgents.mock.calls[0][1]).toBe(workspace);
  });

  it("requires an explicit plan when workspace is supplied", async () => {
    const r = await planHandler.execute(
      { action: "plan", workspace: fx.worktree, autoWork: false },
      context(),
      "agent",
    );

    expect(r.details?.error).toBe("workspace_requires_prd");
    expectNoPlanningStarted();
  });

  it("rejects an explicitly empty workspace with a plan before planning", async () => {
    const r = await planHandler.execute(
      {
        action: "plan",
        prd: "docs/superpowers/plans/example.md",
        workspace: "",
        autoWork: false,
      },
      context(),
      "agent",
    );

    expect(r.details?.error).toBe("workspace_not_absolute");
    expectNoPlanningStarted();
  });

  it("rejects an explicitly empty workspace without a plan before discovery", async () => {
    const r = await planHandler.execute(
      { action: "plan", workspace: "", autoWork: false },
      context(),
      "agent",
    );

    expect(r.details?.error).toBe("workspace_not_absolute");
    expectNoPlanningStarted();
  });

  it("rejects a missing workspace before planning", async () => {
    const missingWorkspace = path.join(fx.worktree, "missing-workspace");
    const r = await planHandler.execute(
      {
        action: "plan",
        prd: "docs/superpowers/plans/example.md",
        workspace: missingWorkspace,
        autoWork: false,
      },
      context(),
      "agent",
    );

    expect(r.details?.error).toBe("workspace_invalid");
    expectNoPlanningStarted();
  });

  it("rejects the main checkout as a workspace", async () => {
    const r = await planHandler.execute(
      {
        action: "plan",
        prd: "docs/superpowers/plans/example.md",
        workspace: fx.main,
        autoWork: false,
      },
      context(fx.main),
      "agent",
    );

    expect(r.details?.error).toBe("workspace_not_linked");
    expectNoPlanningStarted(fx.main);
  });

  it("rejects a plan outside the supplied workspace", async () => {
    const outsidePlan = path.join(fx.main, "outside-plan.md");
    fs.writeFileSync(outsidePlan, "# Outside\n");

    const r = await planHandler.execute(
      {
        action: "plan",
        prd: outsidePlan,
        workspace: fx.worktree,
        autoWork: false,
      },
      context(),
      "agent",
    );

    expect(r.details?.error).toBe("plan_outside_workspace");
    expectNoPlanningStarted();
  });

  it("keeps ordinary plans working without a workspace", async () => {
    const r = await planHandler.execute(
      { action: "plan", prd: "docs/superpowers/plans/example.md", autoWork: false },
      context(),
      "agent",
    );

    expect(r.details?.error).toBeUndefined();
    expect(store.getPlan(fx.worktree)?.workspace).toBeUndefined();
    expect(spawnAgents.mock.calls[0][1]).toBe(fx.worktree);
  });
});

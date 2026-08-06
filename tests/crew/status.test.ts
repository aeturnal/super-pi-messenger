import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execute } from "../../crew/handlers/status.ts";
import { createPlan, createTask, startTask } from "../../crew/store.ts";
import { captureSuperpowersSkills, resetSuperpowersStateForTests } from "../../crew/superpowers.ts";
import * as teamStore from "../../crew/team/store.ts";
import { autonomousState, planningState, PLANNING_STALE_TIMEOUT_MS, startAutonomous, startPlanningRun, stopAutonomous } from "../../crew/state.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { createStockSuperpowersFixture } from "../helpers/superpowers.ts";

function resetPlanningState(): void {
  planningState.active = false;
  planningState.cwd = null;
  planningState.runId = null;
  planningState.pass = 0;
  planningState.maxPasses = 0;
  planningState.phase = "idle";
  planningState.updatedAt = null;
}

function resetAutonomousState(): void {
  autonomousState.active = false;
  autonomousState.cwd = null;
  autonomousState.waveNumber = 0;
  autonomousState.waveHistory = [];
  autonomousState.startedAt = null;
  autonomousState.stoppedAt = null;
  autonomousState.stopReason = null;
  autonomousState.autoOverlayPending = false;
  autonomousState.pid = null;
}

function writeCrewDependenciesConfig(cwd: string, dependencies: "advisory" | "strict"): void {
  const configPath = path.join(cwd, ".pi", "messenger", "crew", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ dependencies }, null, 2));
}

describe("crew.status planning health", () => {
  beforeEach(() => {
    resetPlanningState();
    resetAutonomousState();
    resetSuperpowersStateForTests();
  });
  afterEach(() => {
    resetSuperpowersStateForTests();
    delete process.env.PI_MESSENGER_TEAM_PROFILE_DIR;
  });

  it("shows inactive integration status without a plan", async () => {
    const { cwd } = createTempCrewDirs();

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text.match(/## Superpowers/g)).toHaveLength(1);
    expect(text).toContain("## Superpowers\nSuperpowers integration: inactive");
    expect(response.details.superpowers).toMatchObject({ status: "inactive" });
  });

  it("shows active integration status with a normal plan", async () => {
    const { cwd } = createTempCrewDirs();
    const fixture = createStockSuperpowersFixture();

    try {
      createPlan(cwd, "README.md");
      captureSuperpowersSkills(fixture.skills);

      const response = await execute({ cwd } as any);
      const text = response.content[0].text;

      expect(text.match(/## Superpowers/g)).toHaveLength(1);
      expect(text).toContain([
        "## Superpowers",
        "Superpowers integration: active (6.2.0)",
        "Worker: test-driven-development, verification-before-completion",
        "Reviewer: verification-before-completion",
        "Last launch: none",
        "Restrictions: no nested orchestration or nested worktree management",
      ].join("\n"));
      expect(response.details.superpowers).toMatchObject({
        status: "active",
        version: "6.2.0",
        packageRoot: fs.realpathSync(fixture.root),
        mappings: {
          worker: ["test-driven-development", "verification-before-completion"],
          reviewer: ["verification-before-completion"],
        },
        latestLaunch: null,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("shows Team state before fork-owned Superpowers status", async () => {
    const { cwd } = createTempCrewDirs();
    const fixture = createStockSuperpowersFixture();
    process.env.PI_MESSENGER_TEAM_PROFILE_DIR = path.join(cwd, "profiles");

    try {
      createPlan(cwd, "README.md");
      teamStore.useProfile(cwd, "research-squad");
      const pending = createTask(cwd, "Review auth", "", [], {
        approval: { required: true, status: "pending" },
      });
      captureSuperpowersSkills(fixture.skills);

      const response = await execute({ cwd } as any);
      const text = response.content[0].text;

      expect(text.indexOf("## Team")).toBeGreaterThan(-1);
      expect(text.indexOf("## Superpowers")).toBeGreaterThan(text.indexOf("## Team"));
      expect(text).toContain("Team: research-squad");
      expect(response.details.team).toEqual({
        active: { name: "research-squad", profile: "research-squad" },
        profile: "research-squad",
        charterPresent: false,
        activeRoles: ["planner", "researcher", "reviewer", "scout"],
        memoryCounts: { decision: 0, interface: 0, risk: 0, handoff: 0 },
        needsLead: [
          { id: pending.id, title: "Review auth", approval: { required: true, status: "pending" } },
        ],
        rejected: [],
      });
      expect(response.details.superpowers).toMatchObject({ status: "active" });
    } finally {
      fixture.cleanup();
    }
  });

  it("shows planning next-step guidance instead of all-complete when no tasks exist", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    startPlanningRun(cwd, 2);

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("Planning is in progress.");
    expect(text).not.toContain("All tasks complete!");

    resetPlanningState();
  });

  it("shows stalled planning health when update age exceeds timeout", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    startPlanningRun(cwd, 3);
    planningState.pass = 2;
    planningState.phase = "scan-code";
    planningState.updatedAt = new Date(Date.now() - PLANNING_STALE_TIMEOUT_MS - 30_000).toISOString();

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("Planning health:** stalled");
    expect(text).toContain("timeout 5m");

    const planning = response.details.planning as { stale: boolean };
    expect(planning.stale).toBe(true);

    resetPlanningState();
  });

  it("shows active planning health when updates are recent", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    startPlanningRun(cwd, 2);
    planningState.pass = 1;
    planningState.phase = "scan-code";
    planningState.updatedAt = new Date(Date.now() - 30_000).toISOString();

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("Planning health:** active");

    const planning = response.details.planning as { stale: boolean };
    expect(planning.stale).toBe(false);
  });

  it("shows no-tasks guidance when no tasks exist and planning is inactive", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("No tasks yet. Run `pi_messenger({ action: \"plan\" })`");
    expect(text).not.toContain("All tasks complete!");
  });

  it("does not show autonomous status when autonomous is active for a different cwd", async () => {
    const primary = createTempCrewDirs();
    const secondary = createTempCrewDirs();

    createPlan(primary.cwd, "README.md");
    createPlan(secondary.cwd, "README.md");
    startAutonomous(primary.cwd, 2);

    const response = await execute({ cwd: secondary.cwd } as any);
    const text = response.content[0].text;

    expect(text).not.toContain("## Autonomous Mode");
    expect(response.details.autonomous).toBe(false);

    stopAutonomous("manual");
  });

  it("shows autonomous status when autonomous is active for current cwd", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    startAutonomous(cwd, 2);

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("## Autonomous Mode");
    expect(response.details.autonomous).toBe(true);

    stopAutonomous("manual");
  });

  it("in advisory mode shows Available tasks with inline dependency annotations and no Waiting section", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    writeCrewDependenciesConfig(cwd, "advisory");

    const dep = createTask(cwd, "Types and Config");
    const task = createTask(cwd, "Formatter", "Desc", [dep.id]);
    startTask(cwd, dep.id, "HappyWolf");

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("⬜ **Available**");
    expect(text).toContain(`${task.id}: Formatter (needs: ${dep.id} ⟳)`);
    expect(text).not.toContain("⏸️ **Waiting** (dependencies not met)");
  });

  it("in strict mode preserves Ready and Waiting sections", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    writeCrewDependenciesConfig(cwd, "strict");

    const dep = createTask(cwd, "Types and Config");
    createTask(cwd, "Formatter", "Desc", [dep.id]);

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(text).toContain("⬜ **Ready**");
    expect(text).toContain("⏸️ **Waiting** (dependencies not met)");
  });

  it("recommends approval instead of work when only pending gated tasks are available", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    const pending = createTask(cwd, "Approve auth change", "", [], {
      approval: { required: true, status: "pending" },
    });

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(response.details.tasks).toMatchObject({
      ready: [],
      needsApproval: [
        { id: pending.id, title: pending.title, approval: pending.approval },
      ],
      rejected: [],
    });
    expect(text).toContain(`Needs approval:\n  - ${pending.id}: ${pending.title}`);
    expect(text).toContain(`pi_messenger({ action: "task.approve", id: "${pending.id}" })`);
    expect(text).not.toContain("⬜ **Ready**");
    expect(text).not.toContain('pi_messenger({ action: "work" })');
  });

  it("recommends revision instead of work when only rejected tasks are available", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    const rejected = createTask(cwd, "Revise auth change", "", [], {
      approval: { required: true, status: "rejected", feedback: "Add rollback coverage" },
    });

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(response.details.tasks).toMatchObject({
      ready: [],
      needsApproval: [],
      rejected: [
        { id: rejected.id, title: rejected.title, approval: rejected.approval },
      ],
    });
    expect(text).toContain(`Rejected tasks need revision:\n  - ${rejected.id}: ${rejected.title} — Add rollback coverage`);
    expect(text).toContain(`pi_messenger({ action: "task.revise", id: "${rejected.id}", prompt: "Address approval feedback" })`);
    expect(text).not.toContain("⬜ **Ready**");
    expect(text).not.toContain('pi_messenger({ action: "work" })');
  });

  it("runs only executable tasks while separating pending and rejected tasks", async () => {
    const { cwd } = createTempCrewDirs();
    createPlan(cwd, "README.md");
    const executable = createTask(cwd, "Run formatter");
    const pending = createTask(cwd, "Approve schema change", "", [], {
      approval: { required: true, status: "pending" },
    });
    const rejected = createTask(cwd, "Revise migration", "", [], {
      approval: { required: true, status: "rejected", feedback: "Preserve old data" },
    });

    const response = await execute({ cwd } as any);
    const text = response.content[0].text;

    expect(response.details.tasks).toMatchObject({
      ready: [executable.id],
      needsApproval: [
        { id: pending.id, title: pending.title, approval: pending.approval },
      ],
      rejected: [
        { id: rejected.id, title: rejected.title, approval: rejected.approval },
      ],
    });
    expect(text).toContain(`⬜ **Available**\n  - ${executable.id}: ${executable.title}`);
    expect(text).toContain(`Needs approval:\n  - ${pending.id}: ${pending.title}`);
    expect(text).toContain(`Rejected tasks need revision:\n  - ${rejected.id}: ${rejected.title} — Preserve old data`);
    expect(text).toContain(`Run \`pi_messenger({ action: "work" })\` to execute ${executable.id}`);
    expect(text).not.toContain(`to execute ${executable.id}, ${pending.id}`);
  });
});

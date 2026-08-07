import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../../crew/store.ts";
import { autonomousState, startAutonomous } from "../../crew/state.ts";
import type { AgentResult } from "../../crew/types.ts";
import { readFeedEvents } from "../../feed.ts";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";

function writeAgent(cwd: string, name: "crew-worker" | "crew-reviewer"): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", `${name}.md`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: ${name}
description: Test ${name}
crewRole: ${name === "crew-worker" ? "worker" : "reviewer"}
---
You are a test agent.
`);
}

function createDirs(cwd: string) {
  const base = path.join(cwd, ".pi", "messenger");
  const registry = path.join(base, "registry");
  const inbox = path.join(base, "inbox");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  return { base, registry, inbox };
}

function createProgress(agent: string): AgentResult["progress"] {
  return {
    agent,
    status: "failed",
    recentTools: [],
    toolCallCount: 0,
    tokens: 0,
    durationMs: 0,
  };
}

function failedResult(taskId: string, terminalProviderError?: string): AgentResult {
  return {
    agent: "crew-worker",
    exitCode: 1,
    output: "",
    truncated: false,
    progress: createProgress("crew-worker"),
    taskId,
    error: terminalProviderError ?? "ordinary crash",
    terminalProviderError,
  };
}

function resetAutonomousState(): void {
  autonomousState.active = false;
  autonomousState.cwd = null;
  autonomousState.waveNumber = 0;
  autonomousState.waveHistory = [];
  autonomousState.startedAt = null;
  autonomousState.stoppedAt = null;
  autonomousState.stopReason = null;
  autonomousState.concurrency = 2;
  autonomousState.autoOverlayPending = false;
  autonomousState.pid = null;
}

function configure(cwd: string, options: { review?: boolean; maxAttempts?: number } = {}): void {
  const crewDir = path.join(cwd, ".pi", "messenger", "crew");
  fs.mkdirSync(crewDir, { recursive: true });
  fs.writeFileSync(path.join(crewDir, "config.json"), JSON.stringify({
    work: { maxAttemptsPerTask: options.maxAttempts ?? 1 },
    review: { enabled: options.review ?? false },
    artifacts: { enabled: false },
  }));
}

describe("durable provider failures in Work", () => {
  let dirs: TempCrewDirs;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetAutonomousState();
    dirs = createTempCrewDirs();
    writeAgent(dirs.cwd, "crew-worker");
  });

  it.each([
    "Provider error 429: quota has been exhausted for this account",
    "Provider error 401: Invalid API key",
  ])("resets a durable provider failure to todo and stops autonomous work: %s", async error => {
    configure(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Provider task", "Requires a provider");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");
    vi.spyOn(agents, "spawnAgents").mockResolvedValue([failedResult(task.id, error)]);
    const appendEntry = vi.fn();

    startAutonomous(dirs.cwd, 1);
    const response = await workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      appendEntry,
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 1,
    });
    expect(store.getTask(dirs.cwd, task.id)?.assigned_to).toBeUndefined();
    expect(autonomousState.active).toBe(false);
    expect(autonomousState.stopReason).toBe("provider_failure");
    expect(response.content[0].text).toContain(error);
    expect(response.content[0].text).toContain("Autonomous work stopped");
    expect(response.content[0].text).not.toContain("Continuing to next wave");
    expect(appendEntry).not.toHaveBeenCalledWith("crew_wave_continue", expect.anything());

    expect(store.getTaskProgress(dirs.cwd, task.id)).toContain(error);
    expect(readFeedEvents(dirs.cwd, 20)).toContainEqual(expect.objectContaining({
      type: "task.reset",
      target: task.id,
      preview: "Provider requires user action",
    }));
  });

  it("keeps ordinary failures on the attempt-limit blocking path", async () => {
    configure(dirs.cwd);
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Ordinary failure", "Crashes normally");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");
    vi.spyOn(agents, "spawnAgents").mockResolvedValue([failedResult(task.id)]);

    await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      () => {},
    );

    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "blocked",
      attempt_count: 1,
      blocked_reason: "Max attempts (1) reached",
    });
  });

  it("allows explicit retry after a durable failure when attempts remain", async () => {
    configure(dirs.cwd, { maxAttempts: 5 });
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Retry provider failure", "Can be retried");
    const agents = await import("../../crew/agents.ts");
    const workHandler = await import("../../crew/handlers/work.ts");
    const spawnAgents = vi.spyOn(agents, "spawnAgents")
      .mockResolvedValueOnce([failedResult(task.id, "Provider error 401: Invalid API key")])
      .mockResolvedValueOnce([failedResult(task.id)]);

    startAutonomous(dirs.cwd, 1);
    await workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      vi.fn(),
    );
    await workHandler.execute(
      { action: "work", concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      vi.fn(),
    );

    expect(spawnAgents).toHaveBeenCalledTimes(2);
    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "todo",
      attempt_count: 2,
    });
  });

  it("reviews a completed sibling before stopping for a durable provider failure", async () => {
    configure(dirs.cwd, { review: true });
    writeAgent(dirs.cwd, "crew-reviewer");
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const completed = store.createTask(dirs.cwd, "Completed sibling", "Will ship");
    const failed = store.createTask(dirs.cwd, "Provider sibling", "Will fail");
    const agents = await import("../../crew/agents.ts");
    const review = await import("../../crew/handlers/review.ts");
    const workHandler = await import("../../crew/handlers/work.ts");
    vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
      store.startTask(dirs.cwd, completed.id, "crew-worker");
      store.updateTask(dirs.cwd, completed.id, { base_commit: "abc123" });
      store.completeTask(dirs.cwd, completed.id, "Completed");
      return [
        {
          agent: "crew-worker",
          exitCode: 0,
          output: "",
          truncated: false,
          progress: { ...createProgress("crew-worker"), status: "completed" },
          taskId: completed.id,
        },
        failedResult(failed.id, "Provider error 429: quota has been exhausted for this account"),
      ];
    });
    const reviewImplementation = vi.spyOn(review, "reviewImplementation").mockImplementation(async () => {
      store.updateTask(dirs.cwd, completed.id, {
        last_review: {
          verdict: "SHIP",
          summary: "Ship it",
          issues: [],
          suggestions: [],
          reviewed_at: new Date().toISOString(),
        },
      });
      return { details: { verdict: "SHIP" } } as never;
    });

    startAutonomous(dirs.cwd, 2);
    await workHandler.execute(
      { action: "work", autonomous: true, concurrency: 2 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      vi.fn(),
    );

    expect(reviewImplementation).toHaveBeenCalledWith(dirs.cwd, completed.id, undefined);
    expect(store.getTask(dirs.cwd, completed.id)).toMatchObject({ status: "done", review_count: 1 });
    expect(store.getTask(dirs.cwd, failed.id)).toMatchObject({ status: "todo", attempt_count: 1 });
    expect(autonomousState.stopReason).toBe("provider_failure");
  });
});

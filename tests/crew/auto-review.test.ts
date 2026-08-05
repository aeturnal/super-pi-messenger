import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import * as store from "../../crew/store.ts";
import { readFeedEvents, isCrewEvent } from "../../feed.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import type { ReviewFeedback, Task } from "../../crew/types.ts";

function completedTask(cwd: string, title: string, deps: string[] = []): Task {
  const task = store.createTask(cwd, title, `Spec for ${title}`, deps);
  store.updateTask(cwd, task.id, {
    status: "in_progress",
    started_at: new Date().toISOString(),
    base_commit: "abc123",
    assigned_to: "TestWorker",
    attempt_count: 1,
  });
  store.completeTask(cwd, task.id, "Done");
  return store.getTask(cwd, task.id)!;
}

function writeWorkerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-worker
description: Test worker
crewRole: worker
---
You are a worker.
`);
}

function writeReviewerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-reviewer.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-reviewer
description: Test reviewer
crewRole: reviewer
---
You are a reviewer.
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

function storeReviewFeedback(cwd: string, taskId: string, verdict: ReviewFeedback["verdict"]): void {
  store.updateTask(cwd, taskId, {
    last_review: {
      verdict,
      summary: `Review says ${verdict}`,
      issues: verdict === "SHIP" ? [] : ["Issue one"],
      suggestions: [],
      reviewed_at: new Date().toISOString(),
    },
  });
}

async function runCompletedTask(cwd: string, taskId: string, hasReviewer = false) {
  const agents = await import("../../crew/agents.ts");
  const discover = await import("../../crew/utils/discover.ts");
  vi.spyOn(discover, "discoverCrewAgents").mockReturnValue([
    { name: "crew-worker" },
    ...(hasReviewer ? [{ name: "crew-reviewer" }] : []),
  ] as never);
  const workHandler = await import("../../crew/handlers/work.ts");
  vi.spyOn(agents, "spawnAgents").mockImplementation(async () => {
    store.startTask(cwd, taskId, "crew-worker");
    store.updateTask(cwd, taskId, { base_commit: "abc123" });
    store.completeTask(cwd, taskId, "Done");
    return [{
      agent: "crew-worker",
      exitCode: 0,
      output: "",
      truncated: false,
      progress: {
        agent: "crew-worker",
        status: "completed" as const,
        recentTools: [],
        toolCallCount: 0,
        tokens: 0,
        durationMs: 0,
      },
      taskId,
    }];
  });

  return workHandler.execute(
    { action: "work", concurrency: 1 },
    createDirs(cwd),
    (await import("../helpers/mock-context.ts")).createMockContext(cwd),
    () => {},
  );
}

describe("auto-review store operations", () => {
  it("SHIP: task stays done, review_count incremented", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    storeReviewFeedback(cwd, task.id, "SHIP");

    const reviewCount = (task.review_count ?? 0) + 1;
    store.updateTask(cwd, task.id, { review_count: reviewCount });

    const updated = store.getTask(cwd, task.id)!;
    expect(updated.status).toBe("done");
    expect(updated.review_count).toBe(1);
    expect(updated.last_review?.verdict).toBe("SHIP");
  });

  it("NEEDS_WORK: resetTask preserves review_count and last_review", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    storeReviewFeedback(cwd, task.id, "NEEDS_WORK");
    store.updateTask(cwd, task.id, { review_count: 1 });
    store.resetTask(cwd, task.id);

    const updated = store.getTask(cwd, task.id)!;
    expect(updated.status).toBe("todo");
    expect(updated.review_count).toBe(1);
    expect(updated.last_review?.verdict).toBe("NEEDS_WORK");
    expect(updated.last_review?.issues).toEqual(["Issue one"]);
    expect(updated.completed_at).toBeUndefined();
    expect(updated.summary).toBeUndefined();
    expect(updated.base_commit).toBeUndefined();
    expect(updated.assigned_to).toBeUndefined();
  });

  it("NEEDS_WORK: plan completed_count decremented after resetTask", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    const planBefore = store.getPlan(cwd)!;
    expect(planBefore.completed_count).toBe(1);

    storeReviewFeedback(cwd, task.id, "NEEDS_WORK");
    store.updateTask(cwd, task.id, { review_count: 1 });
    store.resetTask(cwd, task.id);

    const planAfter = store.getPlan(cwd)!;
    expect(planAfter.completed_count).toBe(0);
  });

  it("NEEDS_WORK: reset task appears in getReadyTasks", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    storeReviewFeedback(cwd, task.id, "NEEDS_WORK");
    store.updateTask(cwd, task.id, { review_count: 1 });
    store.resetTask(cwd, task.id);

    const ready = store.getReadyTasks(cwd);
    expect(ready.map(t => t.id)).toContain(task.id);
  });

  it("MAJOR_RETHINK: blockTask sets status and reason", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    storeReviewFeedback(cwd, task.id, "MAJOR_RETHINK");
    store.updateTask(cwd, task.id, { review_count: 1 });
    store.blockTask(cwd, task.id, "Reviewer: Review says MAJOR_RETHINK");

    const updated = store.getTask(cwd, task.id)!;
    expect(updated.status).toBe("blocked");
    expect(updated.blocked_reason).toBe("Reviewer: Review says MAJOR_RETHINK");
    expect(updated.review_count).toBe(1);
    expect(updated.last_review?.verdict).toBe("MAJOR_RETHINK");
  });

  it("MAJOR_RETHINK: blocked task does not appear in getReadyTasks", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    storeReviewFeedback(cwd, task.id, "MAJOR_RETHINK");
    store.updateTask(cwd, task.id, { review_count: 1 });
    store.blockTask(cwd, task.id, "Reviewer: issues");

    const ready = store.getReadyTasks(cwd);
    expect(ready.map(t => t.id)).not.toContain(task.id);
  });

  it("review_count gates review after maxIterations", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = completedTask(cwd, "Build API");

    store.updateTask(cwd, task.id, { review_count: 3 });

    const updated = store.getTask(cwd, task.id)!;
    expect(updated.review_count).toBe(3);
  });

  it("NEEDS_WORK with dependency: dependent task stays done, not cascaded", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const dep = completedTask(cwd, "Foundation");
    const main = completedTask(cwd, "Feature", [dep.id]);

    storeReviewFeedback(cwd, dep.id, "NEEDS_WORK");
    store.updateTask(cwd, dep.id, { review_count: 1 });
    store.resetTask(cwd, dep.id); // no cascade

    const depAfter = store.getTask(cwd, dep.id)!;
    const mainAfter = store.getTask(cwd, main.id)!;
    expect(depAfter.status).toBe("todo");
    expect(mainAfter.status).toBe("done");

    const ready = store.getReadyTasks(cwd);
    expect(ready.map(t => t.id)).toContain(dep.id);
    expect(ready.map(t => t.id)).not.toContain(main.id);
  });

  it("blocks a completed task when no automatic reviewer is available", async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    const { cwd } = createTempCrewDirs();
    writeWorkerAgent(cwd);
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "Build API", "Review required");

    const response = await runCompletedTask(cwd, task.id);

    expect(store.getTask(cwd, task.id)).toMatchObject({
      status: "blocked",
      blocked_reason: "Automatic review unavailable: reviewer agent missing",
    });
    expect(store.getTask(cwd, task.id)?.review_count).toBeUndefined();
    expect(response.details.succeeded).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("blocks a completed task when the automatic reviewer returns no verdict", async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    const { cwd } = createTempCrewDirs();
    writeWorkerAgent(cwd);
    writeReviewerAgent(cwd);
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "Build API", "Review required");
    const review = await import("../../crew/handlers/review.ts");
    vi.spyOn(review, "reviewImplementation").mockResolvedValue({
      details: { error: "reviewer_failed" },
    } as never);

    const response = await runCompletedTask(cwd, task.id, true);

    expect(store.getTask(cwd, task.id)).toMatchObject({
      status: "blocked",
      blocked_reason: "Automatic review unavailable: reviewer returned no verdict",
    });
    expect(store.getTask(cwd, task.id)?.review_count).toBeUndefined();
    expect(response.details.succeeded).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("blocks a completed task after automatic review iterations are exhausted", async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    const { cwd } = createTempCrewDirs();
    writeWorkerAgent(cwd);
    writeReviewerAgent(cwd);
    fs.writeFileSync(path.join(cwd, ".pi", "messenger", "crew", "config.json"), JSON.stringify({
      review: { maxIterations: 1 },
    }));
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "Build API", "Review required");
    store.updateTask(cwd, task.id, { review_count: 1 });
    const review = await import("../../crew/handlers/review.ts");
    vi.spyOn(review, "reviewImplementation").mockResolvedValue({
      details: { verdict: "SHIP" },
    } as never);

    const response = await runCompletedTask(cwd, task.id, true);

    expect(store.getTask(cwd, task.id)).toMatchObject({
      status: "blocked",
      blocked_reason: "Automatic review limit (1) reached",
      review_count: 1,
    });
    expect(response.details.succeeded).toEqual([]);
    expect(response.details.blocked).toEqual([task.id]);
  });

  it("task.review feed event is recognized as crew event", () => {
    const { cwd } = createTempCrewDirs();
    const feedPath = path.join(cwd, ".pi", "messenger", "feed.jsonl");
    fs.mkdirSync(path.dirname(feedPath), { recursive: true });

    const event = {
      ts: new Date().toISOString(),
      agent: "crew",
      type: "task.review" as const,
      target: "task-1",
      preview: "SHIP",
    };
    fs.writeFileSync(feedPath, JSON.stringify(event) + "\n");

    const events = readFeedEvents(cwd, 10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("task.review");
    expect(isCrewEvent("task.review")).toBe(true);
  });

  it("processes an autonomous lobby completion through review before continuing", async () => {
    vi.resetModules();

    let lobbyProc: (EventEmitter & {
      pid: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
      killed: boolean;
      exitCode: number | null;
      kill: () => boolean;
    }) | undefined;
    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const proc = new EventEmitter() as NonNullable<typeof lobbyProc>;
        proc.pid = 4242;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.killed = false;
        proc.exitCode = null;
        proc.kill = () => false;
        lobbyProc = proc;
        return proc;
      }),
    }));

    const dirs = createTempCrewDirs();
    const { createMockContext } = await import("../helpers/mock-context.ts");
    const runtimeStore = await import("../../crew/store.ts");
    const lobby = await import("../../crew/lobby.ts");
    const review = await import("../../crew/handlers/review.ts");
    const state = await import("../../crew/state.ts");
    const workHandler = await import("../../crew/handlers/work.ts");

    writeWorkerAgent(dirs.cwd);
    writeReviewerAgent(dirs.cwd);
    runtimeStore.createPlan(dirs.cwd, "PRD.md");
    const task = runtimeStore.createTask(dirs.cwd, "Lobby task", "Complete through review");
    const dependent = runtimeStore.createTask(dirs.cwd, "Dependent task", "Wait for reviewed lobby task", [task.id]);
    lobby.spawnLobbyWorker(dirs.cwd)!;
    const reviewSpy = vi.spyOn(review, "reviewImplementation").mockResolvedValue({
      details: { verdict: "SHIP" },
    } as never);

    const appendEntry = vi.fn();
    const execution = workHandler.execute(
      { action: "work", autonomous: true, concurrency: 1 },
      createDirs(dirs.cwd),
      createMockContext(dirs.cwd),
      appendEntry,
    );

    await new Promise(resolve => setImmediate(resolve));
    runtimeStore.updateTask(dirs.cwd, task.id, {
      status: "done",
      base_commit: "abc123",
    });
    lobbyProc!.exitCode = 0;
    lobbyProc!.emit("close", 0);

    const response = await execution;

    expect(reviewSpy).toHaveBeenCalledWith(dirs.cwd, task.id, undefined);
    expect(state.autonomousState.waveHistory.at(-1)?.tasksAttempted).toEqual([task.id]);
    expect(appendEntry).toHaveBeenCalledWith("crew_wave_continue", expect.objectContaining({
      readyTasks: expect.arrayContaining([dependent.id]),
    }));
    expect(response.details.succeeded).toEqual([task.id]);

    vi.doUnmock("node:child_process");
  });

  it("no base_commit: review should be skipped", () => {
    const { cwd } = createTempCrewDirs();
    store.createPlan(cwd, "PRD.md");
    const task = store.createTask(cwd, "No git task", "Desc");
    store.updateTask(cwd, task.id, { status: "done", completed_at: new Date().toISOString() });

    const loaded = store.getTask(cwd, task.id)!;
    expect(loaded.base_commit).toBeUndefined();
  });
});

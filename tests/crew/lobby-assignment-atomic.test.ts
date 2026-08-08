import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyWorkerEntry } from "../../crew/registry.ts";
import { registerWorker, unregisterWorker } from "../../crew/registry.ts";
import * as store from "../../crew/store.ts";
import { resolveWorkspace } from "../../crew/workspace.ts";
import { createGitWorktreeFixture } from "../helpers/git-worktree.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

const assignmentHook = vi.hoisted(() => ({ run: undefined as (() => void) | undefined }));
const registeredWorkers: LobbyWorkerEntry[] = [];

vi.mock("../../crew/lobby.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../crew/lobby.ts")>();
  return {
    ...actual,
    assignTaskToLobbyWorker: (...args: Parameters<typeof actual.assignTaskToLobbyWorker>) => {
      assignmentHook.run?.();
      return actual.assignTaskToLobbyWorker(...args);
    },
    spawnWorkerForTask: vi.fn(() => null),
  };
});

function registerIdleWorker(cwd: string, workspace?: LobbyWorkerEntry["workspace"]): LobbyWorkerEntry {
  const lobbyId = `atomic-${Math.random().toString(36).slice(2)}`;
  const aliveFile = path.join(store.getCrewDir(cwd), `lobby-${lobbyId}.alive`);
  fs.mkdirSync(path.dirname(aliveFile), { recursive: true });
  fs.writeFileSync(aliveFile, "", { mode: 0o600 });
  const worker = {
    type: "lobby",
    lobbyId,
    name: "AtomicLobbyWorker",
    cwd,
    proc: {
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: vi.fn(),
    },
    taskId: `__lobby-${lobbyId}__`,
    startedAt: Date.now(),
    assignedTaskId: null,
    managedByWork: false,
    coordination: "chatty",
    promptTmpDir: null,
    aliveFile,
    model: undefined,
    role: "worker",
    superpowersActive: false,
    workspace,
    completion: Promise.resolve({} as never),
    resolveCompletion: vi.fn(),
  } as unknown as LobbyWorkerEntry;
  registerWorker(worker);
  registeredWorkers.push(worker);
  return worker;
}

afterEach(() => {
  assignmentHook.run = undefined;
  for (const worker of registeredWorkers.splice(0)) {
    unregisterWorker(worker.cwd, worker.taskId);
  }
});

describe("atomic lobby task assignment", () => {
  it("keeps task JSON byte-exact when the plan changes immediately before the real assignment", async () => {
    const fixture = createGitWorktreeFixture();
    const workspace = resolveWorkspace(fixture.worktree, fixture.worktree);
    try {
      store.createPlan(fixture.worktree, "docs/PRD.md", undefined, workspace);
      const task = store.createTask(fixture.worktree, "Atomic plan change", "Do work");
      const taskPath = path.join(store.getCrewDir(fixture.worktree), "tasks", `${task.id}.json`);
      const before = fs.readFileSync(taskPath);
      const worker = registerIdleWorker(fixture.worktree, workspace);
      assignmentHook.run = () => {
        store.updatePlan(fixture.worktree, { workspace: undefined });
      };
      const { spawnWorkersForReadyTasks } = await import("../../crew/spawn.ts");

      const result = spawnWorkersForReadyTasks(fixture.worktree, 1);

      expect(result).toMatchObject({ assigned: 0, mutated: false });
      expect(fs.readFileSync(taskPath)).toEqual(before);
      expect(worker.assignedTaskId).toBeNull();
      expect(fs.existsSync(worker.aliveFile!)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps task JSON byte-exact when real inbox delivery fails", async () => {
    const dirs = createTempCrewDirs();
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Atomic delivery", "Do work");
    const taskPath = path.join(dirs.tasksDir, `${task.id}.json`);
    const before = fs.readFileSync(taskPath);
    const inboxPath = path.join(dirs.cwd, ".pi", "messenger", "inbox");
    fs.writeFileSync(inboxPath, "not a directory");
    const worker = registerIdleWorker(dirs.cwd);
    const { spawnWorkersForReadyTasks } = await import("../../crew/spawn.ts");

    const result = spawnWorkersForReadyTasks(dirs.cwd, 1);

    expect(result).toMatchObject({ assigned: 0, mutated: false });
    expect(fs.readFileSync(taskPath)).toEqual(before);
    expect(worker.assignedTaskId).toBeNull();
    expect(fs.existsSync(worker.aliveFile!)).toBe(true);
  });

  it("transitions a task and increments its attempt once on successful delivery", async () => {
    const dirs = createTempCrewDirs();
    store.createPlan(dirs.cwd, "docs/PRD.md");
    const task = store.createTask(dirs.cwd, "Atomic success", "Do work");
    const worker = registerIdleWorker(dirs.cwd);
    const inboxDir = path.join(dirs.cwd, ".pi", "messenger", "inbox");
    const { assignTaskToLobbyWorker } = await import("../../crew/lobby.ts");

    expect(assignTaskToLobbyWorker(worker, task.id, "# Task prompt", inboxDir)).toBe(true);
    expect(store.getTask(dirs.cwd, task.id)).toMatchObject({
      status: "in_progress",
      assigned_to: worker.name,
      attempt_count: 1,
      started_at: expect.any(String),
    });
    expect(worker.assignedTaskId).toBe(task.id);
    expect(fs.existsSync(worker.aliveFile!)).toBe(false);
  });
});

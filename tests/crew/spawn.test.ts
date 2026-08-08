import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.ts";

const homedirMock = vi.hoisted(() => vi.fn());
const lobbyMock = vi.hoisted(() => {
  let counter = 0;
  return {
    getAvailableLobbyWorkers: vi.fn(() => [] as Array<{ name: string; lobbyId: string }>),
    verifyLobbyWorkerAssignment: vi.fn(() => true),
    assignTaskToLobbyWorker: vi.fn(() => true),
    spawnWorkerForTask: vi.fn<() => { name: string } | null>(() => {
      counter++;
      return { name: `SpawnedWorker${counter}` };
    }),
    reset: () => { counter = 0; },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

vi.mock("../../crew/lobby.ts", () => ({
  getAvailableLobbyWorkers: lobbyMock.getAvailableLobbyWorkers,
  verifyLobbyWorkerAssignment: lobbyMock.verifyLobbyWorkerAssignment,
  assignTaskToLobbyWorker: lobbyMock.assignTaskToLobbyWorker,
  spawnWorkerForTask: lobbyMock.spawnWorkerForTask,
}));

vi.mock("../../crew/utils/discover.ts", () => ({
  discoverCrewSkills: vi.fn(() => []),
}));

vi.mock("../../feed.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../feed.ts")>();
  return { ...actual, logFeedEvent: vi.fn() };
});

function writeProjectConfig(crewDir: string, config: Record<string, unknown>): void {
  fs.mkdirSync(crewDir, { recursive: true });
  fs.writeFileSync(path.join(crewDir, "config.json"), JSON.stringify(config, null, 2));
}

describe("spawnWorkersForReadyTasks", () => {
  let dirs: TempCrewDirs;
  let spawn: typeof import("../../crew/spawn.ts");
  let store: typeof import("../../crew/store.ts");

  beforeEach(async () => {
    dirs = createTempCrewDirs();
    homedirMock.mockReturnValue(dirs.root);
    lobbyMock.reset();
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([]);
    lobbyMock.verifyLobbyWorkerAssignment.mockReturnValue(true);
    lobbyMock.assignTaskToLobbyWorker.mockReturnValue(true);
    lobbyMock.spawnWorkerForTask.mockClear();
    lobbyMock.assignTaskToLobbyWorker.mockClear();

    vi.resetModules();
    store = await import("../../crew/store.ts");
    spawn = await import("../../crew/spawn.ts");

    store.createPlan(dirs.cwd, "docs/PRD.md", "Test Plan");
    for (let i = 0; i < 5; i++) {
      store.createTask(dirs.cwd, `Task ${i + 1}`);
    }
  });

  it("respects config.concurrency.max when caller requests more workers", () => {
    writeProjectConfig(dirs.crewDir, { concurrency: { workers: 1, max: 1 } });

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 5);

    expect(result.assigned).toBe(1);
    expect(lobbyMock.spawnWorkerForTask).toHaveBeenCalledTimes(1);
  });

  it("uses the caller limit when it is lower than config.concurrency.max", () => {
    writeProjectConfig(dirs.crewDir, { concurrency: { workers: 2, max: 10 } });

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 2);

    expect(result.assigned).toBe(2);
    expect(lobbyMock.spawnWorkerForTask).toHaveBeenCalledTimes(2);
  });

  it("shares the caller worker cap between lobby and fresh workers", () => {
    writeProjectConfig(dirs.crewDir, { concurrency: { workers: 2, max: 2 } });
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([
      { name: "Lobby1", lobbyId: "lb-1" },
    ]);

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 2);

    expect(result.assigned).toBe(2);
    expect(lobbyMock.assignTaskToLobbyWorker).toHaveBeenCalledTimes(1);
    expect(lobbyMock.spawnWorkerForTask).toHaveBeenCalledTimes(1);
  });

  it("caps lobby assignments by config.concurrency.max", () => {
    writeProjectConfig(dirs.crewDir, { concurrency: { workers: 1, max: 1 } });
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([
      { name: "Lobby1", lobbyId: "lb-1" },
      { name: "Lobby2", lobbyId: "lb-2" },
    ]);

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 5);

    expect(result.assigned).toBe(1);
    expect(lobbyMock.assignTaskToLobbyWorker).toHaveBeenCalledTimes(1);
    expect(lobbyMock.spawnWorkerForTask).not.toHaveBeenCalled();
  });

  it("does not mutate a task when plan identity changes after lobby worker selection", () => {
    const worker = { name: "Lobby1", lobbyId: "lb-1" };
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([worker]);
    lobbyMock.spawnWorkerForTask.mockReturnValue(null);
    const task = store.getTasks(dirs.cwd)[0]!;
    const taskPath = path.join(dirs.tasksDir, `${task.id}.json`);
    const taskBefore = fs.readFileSync(taskPath);

    lobbyMock.verifyLobbyWorkerAssignment.mockImplementationOnce(() => {
      store.updatePlan(dirs.cwd, {
        workspace: {
          root: dirs.cwd,
          gitDir: path.join(dirs.cwd, ".git", "worktrees", "changed"),
          gitCommonDir: path.join(dirs.cwd, ".git"),
        },
      });
      return false;
    });

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 1);

    expect(fs.readFileSync(taskPath)).toEqual(taskBefore);
    expect(store.getPlan(dirs.cwd)?.workspace?.gitDir).toContain("changed");
    expect(lobbyMock.assignTaskToLobbyWorker).not.toHaveBeenCalled();
    expect(result).toMatchObject({ assigned: 0, mutated: false });
  });

  it("reports mutation when a failed lobby assignment retains task start metadata", () => {
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([{ name: "Lobby1", lobbyId: "lb-1" }]);
    lobbyMock.assignTaskToLobbyWorker.mockReturnValue(false);
    lobbyMock.spawnWorkerForTask.mockReturnValue(null);
    vi.spyOn(store, "getBaseCommit").mockReturnValue("base-before-delivery");
    const task = store.getTasks(dirs.cwd)[0]!;

    const result = spawn.spawnWorkersForReadyTasks(dirs.cwd, 1);
    const updated = store.getTask(dirs.cwd, task.id)!;

    expect(result.assigned).toBe(0);
    expect(result.mutated).toBe(true);
    expect(updated.status).toBe("todo");
    expect(updated.assigned_to).toBeUndefined();
    expect(updated.attempt_count).toBe(1);
    expect(updated.started_at).toEqual(expect.any(String));
    expect(updated.base_commit).toBe("base-before-delivery");
  });
});

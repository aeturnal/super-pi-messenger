import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dirs } from "../../lib.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { createProgress } from "../../crew/utils/progress.ts";

const lobbyMock = vi.hoisted(() => ({
  getAvailableLobbyWorkers: vi.fn(() => [] as Array<{ name: string; lobbyId: string }>),
  assignTaskToLobbyWorker: vi.fn((worker: { assignedTaskId: string | null }, taskId: string) => {
    worker.assignedTaskId = taskId;
    return true;
  }),
  cleanupUnassignedAliveFiles: vi.fn(),
  isLobbyWorkerCompatible: vi.fn(() => false),
}));

vi.mock("../../crew/agents.ts", () => ({
  spawnAgents: vi.fn(),
  resolveModel: vi.fn((...models: Array<string | undefined>) => models.find(Boolean)),
  prepareWorkerGuidance: vi.fn(() => ({ active: false, env: {} })),
}));

vi.mock("../../crew/lobby.ts", () => ({
  getAvailableLobbyWorkers: lobbyMock.getAvailableLobbyWorkers,
  assignTaskToLobbyWorker: lobbyMock.assignTaskToLobbyWorker,
  cleanupUnassignedAliveFiles: lobbyMock.cleanupUnassignedAliveFiles,
  isLobbyWorkerCompatible: lobbyMock.isLobbyWorkerCompatible,
}));

describe("work with Team approval", () => {
  let workHandler: typeof import("../../crew/handlers/work.ts");
  let agents: typeof import("../../crew/agents.ts");
  let store: typeof import("../../crew/store.ts");
  let teamStore: typeof import("../../crew/team/store.ts");
  let cwd: string;
  let dirs: Dirs;

  beforeEach(async () => {
    vi.resetModules();
    workHandler = await import("../../crew/handlers/work.ts");
    agents = await import("../../crew/agents.ts");
    store = await import("../../crew/store.ts");
    teamStore = await import("../../crew/team/store.ts");
    vi.clearAllMocks();
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([]);
    lobbyMock.assignTaskToLobbyWorker.mockImplementation((worker, taskId) => {
      worker.assignedTaskId = taskId;
      return true;
    });
    lobbyMock.isLobbyWorkerCompatible.mockReturnValue(false);

    cwd = createTempCrewDirs().cwd;
    process.env.PI_MESSENGER_TEAM_PROFILE_DIR = path.join(cwd, "profiles");
    dirs = {
      base: path.join(cwd, ".pi", "messenger"),
      registry: path.join(cwd, ".pi", "messenger", "registry"),
      inbox: path.join(cwd, ".pi", "messenger", "inbox"),
    };
    fs.mkdirSync(dirs.registry, { recursive: true });
    fs.mkdirSync(dirs.inbox, { recursive: true });
    const agentPath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });
    fs.writeFileSync(agentPath, "---\nname: crew-worker\ndescription: Worker\n---\nWorker");
  });

  afterEach(() => {
    delete process.env.PI_MESSENGER_TEAM_PROFILE_DIR;
  });

  it("leaves an incompatible lobby worker and task unchanged for a fresh worker", async () => {
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Model-specific work", "Do work", [], { model: "task-model" });
    const worker = {
      name: "LobbyWorker",
      lobbyId: "lobby-1",
      assignedTaskId: null,
      cwd,
      model: "lobby-model",
      role: "worker",
      superpowersActive: false,
    };
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([worker]);
    vi.mocked(agents.spawnAgents).mockResolvedValue([
      { exitCode: 1, output: "", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: task.id },
    ]);

    await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(lobbyMock.isLobbyWorkerCompatible).toHaveBeenCalledWith(worker, expect.objectContaining({
      cwd,
      model: "task-model",
      role: "worker",
      superpowersActive: false,
    }));
    expect(lobbyMock.assignTaskToLobbyWorker).not.toHaveBeenCalled();
    expect(worker.assignedTaskId).toBeNull();
    expect(store.getTask(cwd, task.id)?.status).toBe("todo");
  });

  it("fresh-spawns a Scout task instead of assigning a generic lobby worker", async () => {
    teamStore.saveProfile({ name: "scout-team", roles: { scout: {} } });
    teamStore.setActiveTeam(cwd, "scout-team", "scout-team");
    store.createPlan(cwd, "docs/PRD.md");
    const task = store.createTask(cwd, "Scout work", "Inspect", [], { role: "Scout" });
    const worker = {
      name: "LobbyWorker",
      lobbyId: "lobby-1",
      assignedTaskId: null,
      cwd,
      model: undefined,
      role: "worker",
      superpowersActive: false,
    };
    lobbyMock.getAvailableLobbyWorkers.mockReturnValue([worker]);
    lobbyMock.isLobbyWorkerCompatible.mockImplementation((candidate, required) => candidate.role === required.role);
    vi.mocked(agents.spawnAgents).mockResolvedValue([
      { exitCode: 1, output: "", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: task.id },
    ]);

    await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(lobbyMock.isLobbyWorkerCompatible).toHaveBeenCalledWith(worker, expect.objectContaining({ role: "scout" }));
    expect(lobbyMock.assignTaskToLobbyWorker).not.toHaveBeenCalled();
    expect(worker.assignedTaskId).toBeNull();
    expect(agents.spawnAgents).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ taskId: task.id })]),
      cwd,
      expect.any(Object),
    );
  });

  it("skips approval-gated ready tasks without spawning workers", async () => {
    store.createPlan(cwd, "docs/PRD.md");
    store.createTask(cwd, "High risk", "Edit auth", [], {
      role: "worker",
      risk_labels: ["auth"],
      approval: { required: true, status: "pending" },
    });

    const response = await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(agents.spawnAgents).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain("need lead approval");
    expect(response.details.needsApproval).toEqual([
      { id: "task-1", title: "High risk", approval: { required: true, status: "pending" } },
    ]);
  });

  it("does not auto-block approval-gated tasks at max attempts", async () => {
    fs.mkdirSync(path.join(cwd, ".pi", "messenger", "crew"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "messenger", "crew", "config.json"), JSON.stringify({ work: { maxAttemptsPerTask: 1 } }));
    store.createPlan(cwd, "docs/PRD.md");
    const gated = store.createTask(cwd, "High risk", "Edit auth", [], {
      approval: { required: true, status: "pending" },
    });
    store.updateTask(cwd, gated.id, { attempt_count: 1 });

    const response = await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(store.getTask(cwd, gated.id)?.status).toBe("todo");
    expect(response.details.needsApproval).toEqual([
      { id: gated.id, title: gated.title, approval: { required: true, status: "pending" } },
    ]);
  });

  it("uses request model before role and crew config defaults", async () => {
    teamStore.saveProfile({ name: "models", roles: { worker: { model: "role-model" } } });
    teamStore.setActiveTeam(cwd, "models", "models");
    store.createPlan(cwd, "docs/PRD.md");
    store.createTask(cwd, "Normal work", "Do work", [], { role: "worker" });
    vi.mocked(agents.spawnAgents).mockResolvedValue([{ exitCode: 0, output: "", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: "task-1" }]);

    await workHandler.execute({ model: "request-model" }, dirs, createMockContext(cwd), vi.fn());

    expect(agents.spawnAgents).toHaveBeenCalledTimes(1);
    const task = vi.mocked(agents.spawnAgents).mock.calls[0][0][0];
    expect(task.modelOverride).toBe("request-model");
  });

  it("uses canonical role model for mixed-case packaged role names", async () => {
    teamStore.saveProfile({ name: "models", roles: { Scout: { model: "role-model" } } });
    teamStore.setActiveTeam(cwd, "models", "models");
    store.createPlan(cwd, "docs/PRD.md");
    store.createTask(cwd, "Scout work", "Inspect", [], { role: "Scout" });
    vi.mocked(agents.spawnAgents).mockResolvedValue([{ exitCode: 0, output: "", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: "task-1" }]);

    await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(agents.spawnAgents).toHaveBeenCalledTimes(1);
    const task = vi.mocked(agents.spawnAgents).mock.calls[0][0][0];
    expect(task.modelOverride).toBe("role-model");
  });

  it("uses the host session model before agent defaults", async () => {
    store.createPlan(cwd, "docs/PRD.md");
    store.createTask(cwd, "Normal work", "Do work");
    vi.mocked(agents.spawnAgents).mockResolvedValue([{ exitCode: 0, output: "", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: "task-1" }]);

    await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn(), undefined, "session-model");

    expect(agents.spawnAgents).toHaveBeenCalledTimes(1);
    const task = vi.mocked(agents.spawnAgents).mock.calls[0][0][0];
    expect(task.modelOverride).toBe("session-model");
  });

  it("reports rejected ready tasks separately from pending approvals", async () => {
    store.createPlan(cwd, "docs/PRD.md");
    const rejected = store.createTask(cwd, "Rejected auth", "", [], {
      approval: { required: true, status: "rejected", feedback: "needs rollback tests" },
    });

    const response = await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(response.details.needsApproval).toEqual([]);
    expect(response.details.rejected).toEqual([
      { id: rejected.id, title: rejected.title, approval: { required: true, status: "rejected", feedback: "needs rollback tests" } },
    ]);
    expect(response.content[0].text).toContain("Rejected tasks need revision");
    expect(response.content[0].text).toContain('pi_messenger({ action: "task.revise", id: "task-1", prompt: "Address approval feedback" })');
  });

  it("reports approval-gated tasks unlocked after a wave", async () => {
    fs.mkdirSync(path.join(cwd, ".pi", "messenger", "crew"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "messenger", "crew", "config.json"), JSON.stringify({ dependencies: "strict" }));
    store.createPlan(cwd, "docs/PRD.md");
    const first = store.createTask(cwd, "Prepare", "Do prep");
    const gated = store.createTask(cwd, "Change auth", "Edit auth", [first.id], {
      role: "worker",
      risk_labels: ["auth"],
      approval: { required: true, status: "pending" },
    });
    vi.mocked(agents.spawnAgents).mockImplementation(async () => {
      store.updateTask(cwd, first.id, { status: "done", completed_at: new Date().toISOString(), summary: "Done" });
      return [{ exitCode: 0, output: "done", truncated: false, progress: createProgress("crew-worker"), agent: "crew-worker", taskId: first.id }];
    });

    const response = await workHandler.execute({}, dirs, createMockContext(cwd), vi.fn());

    expect(response.details.needsApproval).toEqual([
      { id: gated.id, title: gated.title, approval: { required: true, status: "pending" } },
    ]);
    expect(response.details.nextReady).toEqual([]);
    expect(response.content[0].text).toContain("Needs approval");
  });
});

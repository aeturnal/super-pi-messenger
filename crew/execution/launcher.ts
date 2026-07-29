import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { discoverCrewAgents } from "../utils/discover.js";
import { loadCrewConfig } from "../utils/config.js";
import { registerWorker, unregisterWorkerByAttempt, type LobbyWorkerEntry } from "../registry.js";
import * as taskStore from "../store.js";
import type { Task } from "../types.js";
import { compensateLaunchAttempt, reconcileChildClose } from "./attempts.js";
import {
  clearLobbyAttemptIdentity,
  persistLobbyAttemptIdentity,
} from "./lobby-assignment.js";
import {
  createAttempt,
  readAttempt,
  readSchedulerRecord,
  updateAttempt,
  writeSchedulerRecord,
} from "./store.js";
import { buildPiToolArgs } from "./tool-contract.js";
import type { AttemptRecord, SchedulerRecord } from "./types.js";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface LaunchAttemptRequest {
  cwd: string;
  runId: string;
  controllerId: string;
  leaseEpoch: number;
  task: Task;
  attemptId: string;
  workerName: string;
  prompt: string;
  modelOverride?: string;
  lobbyWorker?: LobbyWorkerEntry;
}

export interface LaunchedAttempt {
  attempt: AttemptRecord;
  proc: ChildProcess;
}

export interface LaunchAttemptDependencies {
  updateTask: typeof taskStore.updateTask;
  createAttempt: typeof createAttempt;
  writeSchedulerRecord(cwd: string, record: SchedulerRecord): void;
  updateAttempt: typeof updateAttempt;
  spawnProcess: typeof spawn;
  registerWorker: typeof registerWorker;
  writeInboxFile(filePath: string, contents: string): void;
}

const defaultLaunchAttemptDependencies: LaunchAttemptDependencies = {
  updateTask: taskStore.updateTask,
  createAttempt,
  writeSchedulerRecord,
  updateAttempt,
  spawnProcess: spawn,
  registerWorker,
  writeInboxFile: (filePath, contents) => fs.writeFileSync(filePath, contents),
};

function addModelArgs(args: string[], model: string | undefined): void {
  if (!model) return;
  const slash = model.indexOf("/");
  if (slash < 0) args.push("--model", model);
  else args.push("--provider", model.slice(0, slash), "--model", model.slice(slash + 1));
}

function compensateBeforeWorkOwnership(request: LaunchAttemptRequest): void {
  compensateLaunchAttempt({
    cwd: request.cwd,
    taskId: request.task.id,
    attemptId: request.attemptId,
    attemptCharged: true,
  });
  if (request.lobbyWorker) {
    clearLobbyAttemptIdentity(request.cwd, request.lobbyWorker.lobbyId, request.attemptId);
  }
}

function hasPersistedLaunchStage(request: LaunchAttemptRequest): boolean {
  return taskStore.getTask(request.cwd, request.task.id)?.current_attempt_id === request.attemptId
    || readAttempt(request.cwd, request.attemptId) !== null
    || readSchedulerRecord(request.cwd)?.activeAttemptIds.includes(request.attemptId) === true;
}

interface InstalledChildHandlers {
  error: (error: Error) => void;
  close: (exitCode: number | null, signal: NodeJS.Signals | null) => void;
}

function installChildHandlers(
  proc: ChildProcess,
  request: LaunchAttemptRequest,
  ownsWork: () => boolean,
): InstalledChildHandlers {
  const error = (_error: Error) => {
    if (!ownsWork()) compensateBeforeWorkOwnership(request);
    unregisterWorkerByAttempt(request.cwd, request.attemptId);
  };
  const close = (exitCode: number | null, signal: NodeJS.Signals | null) => {
    try {
      reconcileChildClose({
        cwd: request.cwd,
        attemptId: request.attemptId,
        exitCode,
        signal,
        closedAt: new Date().toISOString(),
      });
    } finally {
      unregisterWorkerByAttempt(request.cwd, request.attemptId);
      if (request.lobbyWorker) {
        clearLobbyAttemptIdentity(request.cwd, request.lobbyWorker.lobbyId, request.attemptId);
      }
    }
  };
  proc.once("error", error);
  proc.once("close", close);
  return { error, close };
}

function persistLobbyIdentity(request: LaunchAttemptRequest & { lobbyWorker: LobbyWorkerEntry }): void {
  persistLobbyAttemptIdentity(request.cwd, {
    version: 1,
    lobbyId: request.lobbyWorker.lobbyId,
    taskId: request.task.id,
    attemptId: request.attemptId,
    runId: request.runId,
    controllerId: request.controllerId,
  });
}

function deliverLobbyAssignment(
  request: LaunchAttemptRequest & { lobbyWorker: LobbyWorkerEntry },
  dependencies: LaunchAttemptDependencies,
): void {
  const worker = request.lobbyWorker;
  const inbox = path.join(request.cwd, ".pi", "messenger", "inbox", worker.name);
  fs.mkdirSync(inbox, { recursive: true });
  const assignmentPath = path.join(inbox, `${Date.now()}-${randomUUID()}.json`);
  dependencies.writeInboxFile(assignmentPath, JSON.stringify({
    id: randomUUID(),
    from: "crew-orchestrator",
    to: worker.name,
    text: `# Task attempt ${request.attemptId}\n\n${request.prompt}`,
    timestamp: new Date().toISOString(),
    replyTo: null,
    attemptId: request.attemptId,
    runId: request.runId,
    controllerId: request.controllerId,
  }, null, 2));
}

export function launchAttempt(
  request: LaunchAttemptRequest,
  dependencyOverrides: Partial<LaunchAttemptDependencies> = {},
): LaunchedAttempt {
  const dependencies = { ...defaultLaunchAttemptDependencies, ...dependencyOverrides };
  const scheduler = readSchedulerRecord(request.cwd);
  if (!scheduler
    || scheduler.runId !== request.runId
    || scheduler.controllerId !== request.controllerId
    || scheduler.leaseEpoch !== request.leaseEpoch) {
    throw new Error("Attempt launch does not own the active scheduler");
  }
  if (readAttempt(request.cwd, request.attemptId)) {
    throw new Error(`Attempt ${request.attemptId} already exists`);
  }

  const task = taskStore.getTask(request.cwd, request.task.id);
  if (!task || task.status !== "todo" || task.current_attempt_id) {
    throw new Error(`Task ${request.task.id} is not launchable`);
  }

  const startedAt = new Date().toISOString();
  const attempt: AttemptRecord = {
    version: 1,
    attemptId: request.attemptId,
    runId: request.runId,
    taskId: task.id,
    controllerId: request.controllerId,
    leaseEpoch: request.leaseEpoch,
    workerName: request.workerName,
    pid: null,
    startedAt,
    state: "starting",
    attemptCharged: true,
    rollbackApplied: false,
    cancellation: null,
  };

  let taskOwnershipWritten = false;
  let attemptCreated = false;
  let schedulerActivated = false;
  let pointOfNoReturn = false;
  let lobbyHandlers: InstalledChildHandlers | null = null;

  try {
    dependencies.updateTask(request.cwd, task.id, {
      status: "in_progress",
      started_at: startedAt,
      base_commit: taskStore.getBaseCommit(request.cwd),
      assigned_to: request.workerName,
      current_attempt_id: request.attemptId,
      attempt_count: task.attempt_count + 1,
    });
    taskOwnershipWritten = true;

    dependencies.createAttempt(request.cwd, attempt);
    attemptCreated = true;

    dependencies.writeSchedulerRecord(request.cwd, {
      ...scheduler,
      activeAttemptIds: [...new Set([...scheduler.activeAttemptIds, request.attemptId])]
        .sort((left, right) => left.localeCompare(right)),
    });
    schedulerActivated = true;

    let proc: ChildProcess;
    if (request.lobbyWorker) {
      const worker = request.lobbyWorker;
      if (worker.assignedTaskId || worker.proc.exitCode !== null) {
        throw new Error(`Lobby worker ${worker.name} is unavailable`);
      }
      proc = worker.proc;
      lobbyHandlers = installChildHandlers(proc, request, () => pointOfNoReturn);
      persistLobbyIdentity(request as LaunchAttemptRequest & { lobbyWorker: LobbyWorkerEntry });
      deliverLobbyAssignment(
        request as LaunchAttemptRequest & { lobbyWorker: LobbyWorkerEntry },
        dependencies,
      );
      pointOfNoReturn = true;

      if (worker.aliveFile) fs.rmSync(worker.aliveFile, { force: true });
      worker.assignedTaskId = task.id;
      worker.attemptId = request.attemptId;
      dependencies.registerWorker(worker);
    } else {
      const agentConfig = discoverCrewAgents(request.cwd).find(agent => agent.name === "crew-worker");
      if (!agentConfig) throw new Error("crew-worker agent is unavailable");
      const config = loadCrewConfig(taskStore.getCrewDir(request.cwd));
      const args = ["--mode", "json", "--no-session", "-p"];
      addModelArgs(args, request.modelOverride ?? task.model ?? config.models?.worker ?? agentConfig.model);
      args.push(...buildPiToolArgs(agentConfig, extensionDir), request.prompt);

      proc = dependencies.spawnProcess("pi", args, {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...(config.work.env ?? {}),
          PI_CREW_WORKER: "1",
          PI_AGENT_NAME: request.workerName,
          PI_CREW_ATTEMPT_ID: request.attemptId,
          PI_CREW_RUN_ID: request.runId,
          PI_CREW_CONTROLLER_ID: request.controllerId,
        },
      });
      pointOfNoReturn = proc.pid !== undefined;
      installChildHandlers(proc, request, () => pointOfNoReturn);
      dependencies.registerWorker({
        type: "worker",
        proc,
        name: request.workerName,
        cwd: request.cwd,
        taskId: task.id,
        attemptId: request.attemptId,
      });
    }

    const running = dependencies.updateAttempt(request.cwd, request.attemptId, current => ({
      ...current,
      pid: proc.pid ?? null,
      state: "running",
    }));
    return { attempt: running, proc };
  } catch (error) {
    if (!pointOfNoReturn && request.lobbyWorker && lobbyHandlers) {
      request.lobbyWorker.proc.removeListener("error", lobbyHandlers.error);
      request.lobbyWorker.proc.removeListener("close", lobbyHandlers.close);
    }
    const durableStageReached = taskOwnershipWritten || attemptCreated || schedulerActivated
      || hasPersistedLaunchStage(request);
    if (!pointOfNoReturn && durableStageReached) compensateBeforeWorkOwnership(request);
    throw error;
  }
}

/**
 * Crew - Lobby Workers
 *
 * Spawns idle workers that join the mesh, explore the project, and chat
 * while waiting for task assignments. When tasks become available, they
 * receive assignments via steer message and transition to work mode.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateMemorableName } from "../lib.ts";
import { SUPERPOWERS_CHILD_FLAG } from "./superpowers-guard.ts";
import { normalizeCwd } from "./state.ts";
import type { AgentResult, WorkspaceIdentity } from "./types.ts";
import { verifyPlanWorkspace, workspacePrompt } from "./workspace.ts";
import {
  resolveThinking,
  modelHasThinkingSuffix,
  pushModelArgs,
  getPiCommand,
  prepareWorkerGuidance,
  resolveModel,
} from "./agents.ts";
import { discoverCrewAgents } from "./utils/discover.ts";
import { loadCrewConfig, type CrewConfig } from "./utils/config.ts";
import * as teamStore from "./team/store.ts";
import {
  createProgress,
  getTerminalProviderError,
  parseJsonlLine,
  updateProgress,
} from "./utils/progress.ts";
import { getLiveWorkers, updateLiveWorker, removeLiveWorker } from "./live-progress.ts";
import * as store from "./store.ts";
import { logFeedEvent } from "../feed.ts";
import {
  registerWorker,
  unregisterWorker,
  getLobbyWorkers as registryGetLobbyWorkers,
  getAvailableLobbyWorkers as registryGetAvailableLobbyWorkers,
  getLobbyWorkerCount as registryGetLobbyWorkerCount,
  hasActiveWorker,
  type LobbyWorkerEntry,
} from "./registry.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_DIR = path.resolve(__dirname, "..");
const SUPERPOWERS_GUARD_PATH = path.join(__dirname, "superpowers-guard.ts");

export const LOBBY_TOKEN_BUDGETS: Record<string, number> = {
  none: 10_000,
  minimal: 20_000,
  moderate: 50_000,
  chatty: 100_000,
};

export type LobbyWorker = LobbyWorkerEntry;

export interface LobbyCompatibility {
  cwd: string;
  model?: string;
  role?: string;
  superpowersActive: boolean;
  workspace?: WorkspaceIdentity;
}

function hasMatchingWorkspaceIdentity(
  workerWorkspace: WorkspaceIdentity | undefined,
  requiredWorkspace: WorkspaceIdentity | undefined,
): boolean {
  if (!workerWorkspace || !requiredWorkspace) return workerWorkspace === requiredWorkspace;
  return workerWorkspace.root === requiredWorkspace.root
    && workerWorkspace.gitDir === requiredWorkspace.gitDir
    && workerWorkspace.gitCommonDir === requiredWorkspace.gitCommonDir;
}

export function isLobbyWorkerCompatible(
  worker: LobbyWorker,
  required: LobbyCompatibility,
): boolean {
  return worker.cwd === normalizeCwd(required.cwd)
    && worker.model === required.model
    && worker.role === required.role
    && worker.superpowersActive === required.superpowersActive
    && hasMatchingWorkspaceIdentity(worker.workspace, required.workspace);
}

function lobbyTaskId(id: string): string {
  return `__lobby-${id}__`;
}

export function spawnLobbyWorker(cwd: string, promptOverride?: string, sessionModel?: string, modelOverride?: string): LobbyWorker | null {
  return spawnLobbyWorkerFromSnapshot(
    cwd,
    verifyPlanWorkspace(cwd),
    promptOverride,
    sessionModel,
    modelOverride,
  );
}

function spawnLobbyWorkerFromSnapshot(
  cwd: string,
  workspace: WorkspaceIdentity | null,
  promptOverride?: string,
  sessionModel?: string,
  modelOverride?: string,
): LobbyWorker | null {
  const launchCwd = workspace?.root ?? cwd;
  const agents = discoverCrewAgents(cwd);
  const workerConfig = agents.find(a => a.name === "crew-worker");
  if (!workerConfig) return null;

  const crewDir = store.getCrewDir(cwd);
  const config = loadCrewConfig(crewDir);
  const workerGuidance = prepareWorkerGuidance("worker");
  const id = randomUUID().slice(0, 6);
  let name = generateMemorableName();
  for (let i = 0; i < 5; i++) {
    const existing = registryGetLobbyWorkers(cwd);
    const collision = existing.some(w => w.name === name && w.proc.exitCode === null);
    if (!collision) break;
    name = generateMemorableName();
  }
  const lobbyPrompt = promptOverride ?? buildLobbyPrompt(cwd, config);
  const prompt = workspace ? `${workspacePrompt(workspace)}\n\n${lobbyPrompt}` : lobbyPrompt;

  const args = ["--mode", "json", "--no-session", "-p"];
  const model = modelOverride ?? resolveModel(undefined, undefined, undefined, config.models?.worker, sessionModel, workerConfig.model);
  if (model) pushModelArgs(args, model);

  const thinking = resolveThinking(
    config.thinking?.worker,
    workerConfig.thinking,
  );
  if (thinking && !modelHasThinkingSuffix(model)) {
    args.push("--thinking", thinking);
  }

  if (workerConfig.tools?.length) {
    const allowedTools: string[] = [];
    const extensionPaths: string[] = [];
    for (const tool of workerConfig.tools) {
      if (tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js")) {
        extensionPaths.push(tool);
      } else {
        allowedTools.push(tool);
      }
    }
    if (allowedTools.length > 0) args.push("--tools", allowedTools.join(","));
    for (const ext of extensionPaths) args.push("--extension", ext);
  }

  args.push("--extension", EXTENSION_DIR);
  args.push("--extension", SUPERPOWERS_GUARD_PATH);

  let promptTmpDir: string | null = null;
  if (workerConfig.systemPrompt || workerGuidance.systemPromptSuffix) {
    promptTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-lobby-"));
    const promptPath = path.join(promptTmpDir, "crew-worker.md");
    let appendSystemPrompt = workerConfig.systemPrompt ?? "";
    if (workerGuidance.systemPromptSuffix) {
      appendSystemPrompt += appendSystemPrompt ? `\n\n${workerGuidance.systemPromptSuffix}` : workerGuidance.systemPromptSuffix;
    }
    fs.writeFileSync(promptPath, appendSystemPrompt, { mode: 0o600 });
    args.push("--append-system-prompt", promptPath);
  }

  args.push(prompt);

  const envOverrides = config.work.env ?? {};
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envOverrides,
    PI_AGENT_NAME: name,
    PI_CREW_WORKER: "1",
    PI_CREW_ROLE: "worker",
    PI_LOBBY_ID: id,
    ...(workspace ? { PI_CREW_WORKSPACE_ROOT: workspace.root } : {}),
  };
  if (workerGuidance.active) {
    Object.assign(env, workerGuidance.env);
  } else {
    delete env[SUPERPOWERS_CHILD_FLAG];
  }

  const proc = spawn(getPiCommand(), args, {
    cwd: launchCwd,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  const aliveFile = path.join(crewDir, `lobby-${id}.alive`);
  try { fs.writeFileSync(aliveFile, "", { mode: 0o600 }); } catch {}

  const taskId = lobbyTaskId(id);
  let resolveCompletion!: (result: AgentResult) => void;
  const completion = new Promise<AgentResult>((resolve) => {
    resolveCompletion = resolve;
  });
  const worker: LobbyWorkerEntry = {
    type: "lobby",
    lobbyId: id,
    name,
    cwd: normalizeCwd(launchCwd),
    proc,
    taskId,
    startedAt: Date.now(),
    assignedTaskId: null,
    managedByWork: false,
    coordination: config.coordination ?? "chatty",
    promptTmpDir,
    aliveFile,
    model,
    role: "worker",
    superpowersActive: workerGuidance.active,
    workspace: workspace ?? undefined,
    completion,
    resolveCompletion,
  };

  registerWorker(worker);

  const progress = createProgress("crew-worker");

  let jsonlBuffer = "";
  let terminalProviderError: string | null = null;
  proc.stdout?.on("data", (data) => {
    try {
      jsonlBuffer += data.toString();
      const lines = jsonlBuffer.split("\n");
      jsonlBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseJsonlLine(line);
        if (event) {
          updateProgress(progress, event, worker.startedAt);
          const providerError = worker.assignedTaskId ? getTerminalProviderError(event) : null;
          if (providerError && !terminalProviderError) {
            terminalProviderError = providerError;
            progress.error = providerError;
            proc.kill("SIGTERM");
          }
          const displayId = worker.assignedTaskId ?? taskId;
          updateLiveWorker(cwd, displayId, {
            taskId: displayId,
            agent: "crew-worker",
            name,
            progress: { ...progress, recentTools: progress.recentTools.map(t => ({ ...t })) },
            startedAt: worker.startedAt,
          });
          if (!worker.assignedTaskId) {
            const currentConfig = loadCrewConfig(crewDir);
            const budget = LOBBY_TOKEN_BUDGETS[currentConfig.coordination ?? "chatty"] ?? LOBBY_TOKEN_BUDGETS.chatty;
            if (progress.tokens > budget) {
              proc.kill("SIGTERM");
            }
          }
        }
      }
    } catch {}
  });

  proc.on("close", (exitCode) => {
    const finalExitCode = terminalProviderError ? 1 : exitCode ?? 1;
    progress.status = finalExitCode === 0 ? "completed" : "failed";
    progress.durationMs = Date.now() - worker.startedAt;
    worker.resolveCompletion({
      agent: "crew-worker",
      taskId: worker.assignedTaskId ?? undefined,
      exitCode: finalExitCode,
      output: "",
      truncated: false,
      progress,
      error: terminalProviderError ?? undefined,
      terminalProviderError: terminalProviderError ?? undefined,
    });

    const displayId = worker.assignedTaskId ?? taskId;
    removeLiveWorker(cwd, displayId);
    unregisterWorker(cwd, taskId);
    if (worker.promptTmpDir) {
      try { fs.rmSync(worker.promptTmpDir, { recursive: true, force: true }); } catch {}
    }
    if (worker.aliveFile) {
      try { fs.unlinkSync(worker.aliveFile); } catch {}
    }
    if (worker.assignedTaskId && !worker.managedByWork) {
      const task = store.getTask(cwd, worker.assignedTaskId);
      if (task && task.status === "in_progress" && task.assigned_to === worker.name) {
        const config = loadCrewConfig(store.getCrewDir(cwd));
        if (task.attempt_count >= config.work.maxAttemptsPerTask) {
          store.updateTask(cwd, worker.assignedTaskId, {
            status: "blocked",
            blocked_reason: `Max attempts (${config.work.maxAttemptsPerTask}) reached`,
            assigned_to: undefined,
          });
          logFeedEvent(cwd, worker.name, "task.block", worker.assignedTaskId, `Max attempts reached`);
        } else {
          store.updateTask(cwd, worker.assignedTaskId, { status: "todo", assigned_to: undefined });
          store.appendTaskProgress(cwd, worker.assignedTaskId, "system",
            `Lobby worker ${worker.name} exited (code ${exitCode ?? "unknown"}), reset to todo`);
          logFeedEvent(cwd, worker.name, "task.reset", worker.assignedTaskId, "worker exited");
        }
      }
    } else {
      logFeedEvent(cwd, worker.name, "leave", undefined, `Lobby worker exited (code ${exitCode ?? "unknown"})`);
    }
  });

  updateLiveWorker(cwd, taskId, {
    taskId,
    agent: "crew-worker",
    name,
    progress: { ...progress, recentTools: [] },
    startedAt: worker.startedAt,
  });

  return worker;
}

export function waitForLobbyWorker(worker: LobbyWorker): Promise<AgentResult> {
  return worker.completion;
}

export function getLobbyWorkerCount(cwd: string): number {
  return registryGetLobbyWorkerCount(cwd);
}

export function getAvailableLobbyWorkers(cwd: string): LobbyWorker[] {
  return registryGetAvailableLobbyWorkers(cwd);
}

export function verifyLobbyWorkerAssignment(worker: LobbyWorker): boolean {
  if (worker.assignedTaskId) return false;
  if (worker.proc.exitCode !== null) return false;
  const workspace = verifyPlanWorkspace(worker.cwd);
  return hasMatchingWorkspaceIdentity(worker.workspace, workspace ?? undefined);
}

export function assignTaskToLobbyWorker(
  worker: LobbyWorker,
  taskId: string,
  taskPrompt: string,
  inboxDir: string,
): boolean {
  if (!verifyLobbyWorkerAssignment(worker)) return false;

  const task = store.getTask(worker.cwd, taskId);
  if (!task || task.status !== "todo") return false;

  const taskPath = path.join(store.getCrewDir(worker.cwd), "tasks", `${taskId}.json`);
  let taskBytes: Buffer;
  try {
    taskBytes = fs.readFileSync(taskPath);
  } catch {
    return false;
  }

  const targetInbox = path.join(inboxDir, worker.name);
  const random = Math.random().toString(36).substring(2, 8);
  const msgFile = path.join(targetInbox, `${Date.now()}-${random}.json`);
  const aliveFile = worker.aliveFile;
  const aliveBytes = aliveFile && fs.existsSync(aliveFile) ? fs.readFileSync(aliveFile) : null;
  const lobbyId = lobbyTaskId(worker.lobbyId);
  const previousLiveWorker = getLiveWorkers(worker.cwd).get(lobbyId);
  const previousAssignedTaskId = worker.assignedTaskId;
  let messageWritten = false;
  let liveWorkerRemoved = false;

  const msg = {
    id: randomUUID(),
    from: "crew-orchestrator",
    to: worker.name,
    text: `# ⚡ TASK ASSIGNMENT — SWITCH TO WORK MODE

Drop your current activity and work on this task immediately.

**IMPORTANT:** This task is already claimed and started for you — do NOT call \`task.start\`. Follow the assignment below, including any Team role or read-only instructions, then mark complete with \`task.done\`.

${taskPrompt}`,
    timestamp: new Date().toISOString(),
    replyTo: null,
  };

  try {
    const updated = store.updateTask(worker.cwd, taskId, {
      status: "in_progress",
      started_at: new Date().toISOString(),
      base_commit: store.getBaseCommit(worker.cwd),
      assigned_to: worker.name,
      attempt_count: task.attempt_count + 1,
    });
    if (!updated) throw new Error("task_update_failed");

    fs.mkdirSync(targetInbox, { recursive: true });
    if (aliveFile && aliveBytes) fs.unlinkSync(aliveFile);
    messageWritten = true;
    fs.writeFileSync(msgFile, JSON.stringify(msg, null, 2));
    liveWorkerRemoved = true;
    removeLiveWorker(worker.cwd, lobbyId);
    worker.assignedTaskId = taskId;
    return true;
  } catch {
    try { fs.writeFileSync(taskPath, taskBytes); } catch {}
    worker.assignedTaskId = previousAssignedTaskId;
    if (messageWritten) {
      try { fs.unlinkSync(msgFile); } catch {}
    }
    if (aliveFile && aliveBytes && !fs.existsSync(aliveFile)) {
      try { fs.writeFileSync(aliveFile, aliveBytes, { mode: 0o600 }); } catch {}
    }
    if (liveWorkerRemoved && previousLiveWorker) {
      const { cwd: _cwd, ...liveWorker } = previousLiveWorker;
      try { updateLiveWorker(worker.cwd, lobbyId, liveWorker); } catch {}
    }
    return false;
  }
}

export function killLobbyWorkerForTask(cwd: string, taskId: string): boolean {
  const all = registryGetLobbyWorkers(cwd);
  for (const worker of all) {
    if (worker.assignedTaskId !== taskId) continue;
    if (worker.proc.exitCode === null) {
      worker.proc.kill("SIGTERM");
    }
    if (worker.aliveFile) {
      try { fs.unlinkSync(worker.aliveFile); } catch {}
    }
    return true;
  }
  return false;
}

export function shutdownLobbyWorkers(cwd: string): void {
  const all = registryGetLobbyWorkers(cwd);
  for (const worker of all) {
    if (worker.proc.exitCode === null) {
      worker.proc.kill("SIGTERM");
    }
    const displayId = worker.assignedTaskId ?? worker.taskId;
    removeLiveWorker(cwd, displayId);
    unregisterWorker(cwd, worker.taskId);
    if (worker.promptTmpDir) {
      try { fs.rmSync(worker.promptTmpDir, { recursive: true, force: true }); } catch {}
    }
    if (worker.aliveFile) {
      try { fs.unlinkSync(worker.aliveFile); } catch {}
    }
  }

  const crewDir = store.getCrewDir(cwd);
  try {
    for (const f of fs.readdirSync(crewDir)) {
      if (f.startsWith("lobby-") && f.endsWith(".alive")) {
        try { fs.unlinkSync(path.join(crewDir, f)); } catch {}
      }
    }
  } catch {}
}

export function cleanupUnassignedAliveFiles(cwd: string): void {
  const workers = registryGetLobbyWorkers(cwd);
  for (const worker of workers) {
    if (!worker.assignedTaskId && worker.aliveFile) {
      try { fs.unlinkSync(worker.aliveFile); } catch {}
    }
  }
}

export function spawnWorkerForTask(
  cwd: string,
  taskId: string,
  taskPrompt: string,
  sessionModel?: string,
  requestModel?: string,
): LobbyWorker | null {
  const task = store.getTask(cwd, taskId);
  if (!task || task.status !== "todo") return null;
  if (hasActiveWorker(cwd, taskId)) return null;

  const workspace = verifyPlanWorkspace(cwd);
  const config = loadCrewConfig(store.getCrewDir(cwd));
  const roleName = teamStore.resolveRoleName(cwd, task.role);
  const roleModel = roleName ? teamStore.resolveRoles(cwd)[roleName]?.model : undefined;
  const taskModel = resolveModel(task.model, requestModel, roleModel, config.models?.worker, sessionModel);
  const worker = spawnLobbyWorkerFromSnapshot(cwd, workspace, taskPrompt, sessionModel, taskModel);
  if (!worker) return null;

  removeLiveWorker(cwd, lobbyTaskId(worker.lobbyId));
  worker.assignedTaskId = taskId;
  if (worker.aliveFile) {
    try { fs.unlinkSync(worker.aliveFile); } catch {}
  }
  store.updateTask(cwd, taskId, {
    status: "in_progress",
    started_at: new Date().toISOString(),
    base_commit: store.getBaseCommit(cwd),
    assigned_to: worker.name,
    attempt_count: task.attempt_count + 1,
  });
  store.appendTaskProgress(cwd, taskId, "system", `Assigned to worker ${worker.name} (attempt ${task.attempt_count + 1})`);
  logFeedEvent(cwd, worker.name, "task.start", taskId, task.title);

  return worker;
}

export function removeLobbyWorkerByIndex(cwd: string): boolean {
  const available = registryGetAvailableLobbyWorkers(cwd);
  if (available.length === 0) return false;
  const worker = available[0];
  if (worker.proc.exitCode === null) {
    worker.proc.kill("SIGTERM");
  }
  removeLiveWorker(cwd, worker.taskId);
  unregisterWorker(cwd, worker.taskId);
  if (worker.promptTmpDir) {
    try { fs.rmSync(worker.promptTmpDir, { recursive: true, force: true }); } catch {}
  }
  if (worker.aliveFile) {
    try { fs.unlinkSync(worker.aliveFile); } catch {}
  }
  return true;
}

function buildLobbyPrompt(cwd: string, config: CrewConfig): string {
  const plan = store.getPlan(cwd);
  const prdPath = plan?.prd;
  const level = config.coordination ?? "chatty";

  let prompt = `# Crew Lobby

You're a crew worker waiting for the team's plan to be finalized. There's no task for you yet — hang tight.

## Step 1: Join the Mesh

\`\`\`typescript
pi_messenger({ action: "join" })
\`\`\`

## Step 2: Get Familiar

`;

  if (level === "none") {
    prompt += `Skip this step — you'll get full context when your task arrives.

`;
  } else if (prdPath) {
    prompt += `Read the PRD to understand what the team is building:

\`\`\`typescript
read("${prdPath}")
\`\`\`

`;
  }

  if (level === "chatty" || level === "moderate") {
    prompt += `Briefly explore the project structure to get oriented. Don't go deep — save your budget for the actual task.

`;
  }

  if (level === "chatty") {
    prompt += `## Step 3: Share Your Findings

Post updates to the team feed while you wait — the user watches it live. Other workers will see your broadcasts when they receive their task assignment.

- **Introduce yourself** — broadcast a greeting when you join
- **Share observations** — broadcast anything interesting you notice about the PRD
- **Respond to DMs** — if someone messages you directly, reply briefly

**Hard limit: send at most 5 messages total (broadcasts + DMs combined).** After that, stop messaging and wait quietly. Save your context for the actual task.

\`\`\`typescript
pi_messenger({ action: "broadcast", message: "Hey team! Just joined. Reading the PRD now..." })
\`\`\`

After sending your messages, wait for a **TASK ASSIGNMENT** message.
`;
  } else if (level === "moderate") {
    prompt += `## Step 3: Brief Check-in

Announce yourself, then wait:

\`\`\`typescript
pi_messenger({ action: "broadcast", message: "Joined the lobby. Reading the PRD..." })
\`\`\`

**Hard limit: send at most 2 messages total.** You may reply once if someone DMs you. Then stop messaging and wait.

Wait for a **TASK ASSIGNMENT** message to begin work.
`;
  } else if (level === "minimal") {
    prompt += `## Step 3: Wait for Assignment

Announce your presence with one broadcast, then wait:

\`\`\`typescript
pi_messenger({ action: "broadcast", message: "Standing by for task assignment." })
\`\`\`

**Do NOT send any other messages.** Wait for a **TASK ASSIGNMENT** message to begin work.
`;
  } else {
    prompt += `## Step 3: Wait

**Do NOT send any messages, do NOT explore the codebase.** Wait for a **TASK ASSIGNMENT** message.
`;
  }

  prompt += `
## When You Receive a Task Assignment

You will receive a message with the header **⚡ TASK ASSIGNMENT**. When you get it:

1. Read the task details carefully — the assignment message has specific instructions
2. Reserve files you'll modify
3. Implement the feature following the spec
4. Run tests to verify
5. Commit your changes
6. Release reservations and mark complete

The task will already be claimed and started for you — do NOT call \`task.start\`. Switch to full work mode immediately — no more lobby chat.
`;

  return prompt;
}

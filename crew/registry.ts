/**
 * Crew - Unified Worker Registry
 *
 * Single registry for both regular workers and lobby workers.
 * Replaces the separate maps in agents.ts and lobby.ts.
 */

import type { ChildProcess } from "node:child_process";
import type { CoordinationLevel } from "./utils/config.ts";
import { normalizeCwd } from "./state.ts";

interface BaseWorkerEntry {
  proc: ChildProcess;
  name: string;
  cwd: string;
  taskId: string;
}

export interface RegularWorker extends BaseWorkerEntry {
  type: "worker";
}

export interface LobbyWorkerEntry extends BaseWorkerEntry {
  type: "lobby";
  lobbyId: string;
  assignedTaskId: string | null;
  coordination: CoordinationLevel;
  startedAt: number;
  promptTmpDir: string | null;
  aliveFile: string | null;
  model?: string;
  role?: string;
  superpowersActive: boolean;
}

export type WorkerEntry = RegularWorker | LobbyWorkerEntry;

const workers = new Map<string, WorkerEntry>();

function makeKey(cwd: string, taskId: string): string {
  return `${normalizeCwd(cwd)}::${taskId}`;
}

export function registerWorker(entry: WorkerEntry): void {
  workers.set(makeKey(entry.cwd, entry.taskId), entry);
}

export function unregisterWorker(cwd: string, taskId: string): void {
  workers.delete(makeKey(cwd, taskId));
}

export function findWorkerByTask(cwd: string, taskId: string): WorkerEntry | null {
  const normalizedCwd = normalizeCwd(cwd);
  const direct = workers.get(makeKey(normalizedCwd, taskId));
  if (direct) return direct;
  for (const entry of workers.values()) {
    if (normalizeCwd(entry.cwd) !== normalizedCwd) continue;
    if (entry.type === "lobby" && entry.assignedTaskId === taskId) return entry;
  }
  return null;
}

export function hasActiveWorker(cwd: string, taskId: string): boolean {
  const entry = findWorkerByTask(cwd, taskId);
  if (!entry) return false;
  return entry.proc.exitCode === null && !entry.proc.killed;
}

export function killWorkerByTask(cwd: string, taskId: string): boolean {
  const entry = findWorkerByTask(cwd, taskId);
  if (!entry) return false;
  if (entry.proc.exitCode === null && !entry.proc.killed) {
    entry.proc.kill("SIGTERM");
    const ref = entry.proc;
    const timer = setTimeout(() => {
      if (ref.exitCode === null) ref.kill("SIGKILL");
    }, 5000);
    timer.unref();
    return true;
  }
  return false;
}

export function killAll(cwd?: string): void {
  const normalizedCwd = cwd ? normalizeCwd(cwd) : undefined;
  for (const [key, entry] of workers.entries()) {
    if (normalizedCwd && normalizeCwd(entry.cwd) !== normalizedCwd) continue;
    if (entry.proc.exitCode === null && !entry.proc.killed) {
      entry.proc.kill("SIGTERM");
    }
    workers.delete(key);
  }
}

export function getLobbyWorkers(cwd: string): LobbyWorkerEntry[] {
  const normalizedCwd = normalizeCwd(cwd);
  const result: LobbyWorkerEntry[] = [];
  for (const entry of workers.values()) {
    if (normalizeCwd(entry.cwd) === normalizedCwd && entry.type === "lobby") result.push(entry);
  }
  return result;
}

export function getAvailableLobbyWorkers(cwd: string): LobbyWorkerEntry[] {
  const normalizedCwd = normalizeCwd(cwd);
  const result: LobbyWorkerEntry[] = [];
  for (const entry of workers.values()) {
    if (normalizeCwd(entry.cwd) !== normalizedCwd || entry.type !== "lobby") continue;
    if (entry.assignedTaskId) continue;
    if (entry.proc.exitCode !== null) continue;
    result.push(entry);
  }
  return result;
}

export function getLobbyWorkerCount(cwd: string): number {
  const normalizedCwd = normalizeCwd(cwd);
  let count = 0;
  for (const entry of workers.values()) {
    if (normalizeCwd(entry.cwd) === normalizedCwd && entry.type === "lobby" && !entry.assignedTaskId && entry.proc.exitCode === null) count++;
  }
  return count;
}

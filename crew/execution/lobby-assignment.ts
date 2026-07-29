import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "./store.js";

export interface LobbyAttemptIdentity {
  version: 1;
  lobbyId: string;
  taskId: string;
  attemptId: string;
  runId: string;
  controllerId: string;
}

function assignmentPath(cwd: string, lobbyId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(lobbyId)) throw new Error("Invalid lobby ID");
  return path.join(cwd, ".pi", "messenger", "crew", "lobby-assignments", `${lobbyId}.json`);
}

function isIdentity(value: unknown, lobbyId: string): value is LobbyAttemptIdentity {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && record.lobbyId === lobbyId
    && typeof record.taskId === "string"
    && typeof record.attemptId === "string"
    && typeof record.runId === "string"
    && typeof record.controllerId === "string";
}

function readIdentity(filePath: string, lobbyId: string): LobbyAttemptIdentity | null {
  if (!fs.existsSync(filePath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid lobby assignment for ${lobbyId}`, { cause: error });
  }
  if (!isIdentity(value, lobbyId)) throw new Error(`Invalid lobby assignment for ${lobbyId}`);
  return value;
}

export function persistLobbyAttemptIdentity(cwd: string, identity: LobbyAttemptIdentity): void {
  atomicWriteJson(assignmentPath(cwd, identity.lobbyId), identity);
}

export function resolveLobbyAttemptIdentity(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): LobbyAttemptIdentity | null {
  const lobbyId = env.PI_LOBBY_ID;
  if (!lobbyId) return null;
  return readIdentity(assignmentPath(cwd, lobbyId), lobbyId);
}

export function clearLobbyAttemptIdentity(cwd: string, lobbyId: string, attemptId: string): void {
  const filePath = assignmentPath(cwd, lobbyId);
  const identity = readIdentity(filePath, lobbyId);
  if (identity?.attemptId === attemptId) fs.rmSync(filePath, { force: true });
}

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plan } from "../types.js";
import type { AttemptRecord, SchedulerRecord } from "./types.js";

interface PlanMigrationDependencies {
  uuid: () => string;
  now: () => string;
}

interface RunIdentity {
  version: 1;
  runId: string;
}

const defaultPlanMigrationDependencies: PlanMigrationDependencies = {
  uuid: randomUUID,
  now: () => new Date().toISOString(),
};

function crewDirectory(cwd: string): string {
  return path.join(cwd, ".pi", "messenger", "crew");
}

export function schedulerPath(cwd: string): string {
  return path.join(crewDirectory(cwd), "scheduler.json");
}

export function attemptPath(cwd: string, attemptId: string): string {
  return path.join(crewDirectory(cwd), "attempts", `${attemptId}.json`);
}

export function leaseDirectory(cwd: string): string {
  return path.join(crewDirectory(cwd), "controller-lease");
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function readJson(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}`, { cause: error });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateSchedulerRecord(value: unknown): SchedulerRecord {
  if (!isObject(value) || value.version !== 1 || typeof value.runId !== "string" || typeof value.controllerId !== "string") {
    throw new Error("Invalid scheduler record");
  }
  return value as unknown as SchedulerRecord;
}

function validateAttemptRecord(value: unknown, expectedAttemptId: string): AttemptRecord {
  if (!isObject(value) || value.version !== 1 || value.attemptId !== expectedAttemptId) {
    throw new Error(`Invalid attempt record for ${expectedAttemptId}`);
  }
  return value as unknown as AttemptRecord;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readRunIdentity(filePath: string): RunIdentity | null {
  if (!fs.existsSync(filePath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Invalid run identity");
  }
  if (!isObject(value) || value.version !== 1 || !isUuid(value.runId)) {
    throw new Error("Invalid run identity");
  }
  return value as unknown as RunIdentity;
}

function publishRunIdentity(filePath: string, identity: RunIdentity): void {
  const candidatePath = `${filePath}.candidate-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(candidatePath, JSON.stringify(identity, null, 2));
  try {
    try {
      fs.linkSync(candidatePath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    fs.rmSync(candidatePath, { force: true });
  }
}

export function ensurePlanRunId(
  cwd: string,
  dependencies: PlanMigrationDependencies = defaultPlanMigrationDependencies,
): Plan {
  const planPath = path.join(crewDirectory(cwd), "plan.json");
  const identityPath = path.join(crewDirectory(cwd), "run-id.json");
  const initialValue = readJson(planPath);
  if (!isObject(initialValue)) throw new Error("Crew plan does not exist or is invalid");

  const initialPlan = initialValue as unknown as Plan;
  if (initialPlan.run_id !== undefined) {
    if (!isUuid(initialPlan.run_id)) throw new Error("Invalid plan run identity");
    fs.rmSync(identityPath, { force: true });
    return initialPlan;
  }

  let identity = readRunIdentity(identityPath);
  if (!identity) {
    const candidateRunId = dependencies.uuid();
    if (!isUuid(candidateRunId)) throw new Error("Invalid run identity");
    publishRunIdentity(identityPath, { version: 1, runId: candidateRunId });
    identity = readRunIdentity(identityPath);
  }
  if (!identity) throw new Error("Run identity publication failed");

  const currentValue = readJson(planPath);
  if (!isObject(currentValue)) throw new Error("Crew plan does not exist or is invalid");
  const currentPlan = currentValue as unknown as Plan;
  if (currentPlan.run_id !== undefined) {
    if (!isUuid(currentPlan.run_id)) throw new Error("Invalid plan run identity");
    fs.rmSync(identityPath, { force: true });
    return currentPlan;
  }

  const migrated: Plan = {
    ...currentPlan,
    run_id: identity.runId,
    updated_at: dependencies.now(),
  };
  atomicWriteJson(planPath, migrated);
  fs.rmSync(identityPath, { force: true });
  return migrated;
}

export function readSchedulerRecord(cwd: string): SchedulerRecord | null {
  const value = readJson(schedulerPath(cwd));
  return value === null ? null : validateSchedulerRecord(value);
}

export function writeSchedulerRecord(cwd: string, record: SchedulerRecord): void {
  atomicWriteJson(schedulerPath(cwd), validateSchedulerRecord(record));
}

export function createAttempt(cwd: string, attempt: AttemptRecord): void {
  atomicWriteJson(attemptPath(cwd, attempt.attemptId), validateAttemptRecord(attempt, attempt.attemptId));
}

export function readAttempt(cwd: string, attemptId: string): AttemptRecord | null {
  const value = readJson(attemptPath(cwd, attemptId));
  return value === null ? null : validateAttemptRecord(value, attemptId);
}

export function updateAttempt(
  cwd: string,
  attemptId: string,
  mutate: (current: AttemptRecord) => AttemptRecord,
): AttemptRecord {
  const current = readAttempt(cwd, attemptId);
  if (!current) throw new Error(`Attempt ${attemptId} does not exist`);

  const updated = mutate(current);
  if (updated.attemptId !== attemptId) {
    throw new Error("Attempt ID cannot be changed");
  }
  validateAttemptRecord(updated, attemptId);
  atomicWriteJson(attemptPath(cwd, attemptId), updated);
  return updated;
}

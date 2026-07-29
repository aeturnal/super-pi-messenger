import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson, leaseDirectory } from "./store.js";
import type { ControllerLease } from "./types.js";

export type LeaseAcquisition =
  | { acquired: true; reclaimed: boolean; lease: ControllerLease }
  | { acquired: false; reason: "live_owner" | "plan_identity_mismatch" | "repository_identity_mismatch" | "race_lost"; lease?: ControllerLease };

interface LeaseDependencies {
  pid: number;
  now: () => string;
  isProcessAlive: (pid: number) => boolean;
}

const defaultLeaseDependencies: LeaseDependencies = {
  pid: process.pid,
  now: () => new Date().toISOString(),
  isProcessAlive: pid => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

interface EpochRecord {
  version: 1;
  leaseEpoch: number;
}

type LeaseDirectoryState =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid"; lease: ControllerLease };

function normalizedRepositoryPath(cwd: string): string {
  return path.normalize(fs.realpathSync(cwd));
}

function planRunId(cwd: string): string | null {
  const planPath = path.join(cwd, ".pi", "messenger", "crew", "plan.json");
  try {
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as { run_id?: unknown };
    return typeof plan.run_id === "string" && plan.run_id.length > 0 ? plan.run_id : null;
  } catch {
    return null;
  }
}

function isControllerLease(value: unknown): value is ControllerLease {
  if (typeof value !== "object" || value === null) return false;
  const lease = value as Partial<ControllerLease>;
  return lease.version === 1
    && typeof lease.controllerId === "string"
    && lease.controllerId.length > 0
    && Number.isInteger(lease.leaseEpoch)
    && (lease.leaseEpoch ?? 0) > 0
    && Number.isInteger(lease.pid)
    && (lease.pid ?? 0) > 0
    && typeof lease.planRunId === "string"
    && lease.planRunId.length > 0
    && typeof lease.normalizedRepoPath === "string"
    && lease.normalizedRepoPath.length > 0
    && typeof lease.acquiredAt === "string"
    && lease.acquiredAt.length > 0;
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readLeaseDirectory(directory: string): LeaseDirectoryState {
  if (!fs.existsSync(directory)) return { kind: "absent" };
  const lease = readJson(path.join(directory, "lease.json"));
  const epoch = readJson(path.join(directory, "epoch.json"));
  if (
    !isControllerLease(lease)
    || typeof epoch !== "object"
    || epoch === null
    || (epoch as Partial<EpochRecord>).version !== 1
    || (epoch as Partial<EpochRecord>).leaseEpoch !== lease.leaseEpoch
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", lease };
}

function sameLease(left: ControllerLease, right: ControllerLease): boolean {
  return left.version === right.version
    && left.controllerId === right.controllerId
    && left.leaseEpoch === right.leaseEpoch
    && left.pid === right.pid
    && left.planRunId === right.planRunId
    && left.normalizedRepoPath === right.normalizedRepoPath
    && left.acquiredAt === right.acquiredAt;
}

function createLease(
  controllerId: string,
  leaseEpoch: number,
  pid: number,
  runId: string,
  normalizedRepoPath: string,
  acquiredAt: string,
): ControllerLease {
  return {
    version: 1,
    controllerId,
    leaseEpoch,
    pid,
    planRunId: runId,
    normalizedRepoPath,
    acquiredAt,
  };
}

function prepareLeaseDirectory(cwd: string, lease: ControllerLease): string {
  const candidate = `${leaseDirectory(cwd)}.candidate-${process.pid}-${randomUUID()}`;
  fs.mkdirSync(candidate);
  try {
    atomicWriteJson(path.join(candidate, "epoch.json"), { version: 1, leaseEpoch: lease.leaseEpoch });
    atomicWriteJson(path.join(candidate, "lease.json"), lease);
    return candidate;
  } catch (error) {
    fs.rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
}

function publishLeaseDirectory(candidate: string, active: string): boolean {
  try {
    fs.renameSync(candidate, active);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY") return false;
    throw error;
  } finally {
    fs.rmSync(candidate, { recursive: true, force: true });
  }
}

function tombstonePath(cwd: string, lease: ControllerLease): string {
  return `${leaseDirectory(cwd)}.stale-${encodeURIComponent(lease.controllerId)}-${lease.leaseEpoch}`;
}

function releaseMarkerPath(cwd: string, lease: ControllerLease): string {
  const name = [
    "controller-lease.release",
    lease.planRunId,
    encodeURIComponent(lease.controllerId),
    lease.leaseEpoch,
    lease.pid,
  ].join("-");
  return path.join(path.dirname(leaseDirectory(cwd)), `${name}.json`);
}

function hasMatchingReleaseMarker(cwd: string, lease: ControllerLease): "no" | "yes" | "invalid" {
  const markerPath = releaseMarkerPath(cwd, lease);
  if (!fs.existsSync(markerPath)) return "no";
  const marker = readJson(markerPath);
  return isControllerLease(marker) && sameLease(marker, lease) ? "yes" : "invalid";
}

function recoverInterruptedTakeover(cwd: string): "none" | "restored" | "invalid" | "race_lost" {
  const active = leaseDirectory(cwd);
  const parent = path.dirname(active);
  const prefix = `${path.basename(active)}.stale-`;
  const tombstones = fs.readdirSync(parent).filter(name => name.startsWith(prefix));
  if (tombstones.length === 0) return "none";

  let selected: { directory: string; lease: ControllerLease } | null = null;
  for (const name of tombstones) {
    const directory = path.join(parent, name);
    const state = readLeaseDirectory(directory);
    if (state.kind !== "valid") return "invalid";
    if (!selected || state.lease.leaseEpoch > selected.lease.leaseEpoch) {
      selected = { directory, lease: state.lease };
    }
  }
  if (!selected) return "invalid";

  try {
    fs.renameSync(selected.directory, active);
    return "restored";
  } catch {
    return fs.existsSync(active) ? "race_lost" : "invalid";
  }
}

function restorePriorGeneration(tombstone: string, active: string): void {
  try {
    fs.renameSync(tombstone, active);
  } catch {}
}

function raceLost(cwd: string): LeaseAcquisition {
  const state = readLeaseDirectory(leaseDirectory(cwd));
  return state.kind === "valid"
    ? { acquired: false, reason: "race_lost", lease: state.lease }
    : { acquired: false, reason: "race_lost" };
}

export function acquireControllerLease(
  cwd: string,
  runId: string,
  controllerId: string,
  dependencies: LeaseDependencies = defaultLeaseDependencies,
): LeaseAcquisition {
  const normalizedRepoPath = normalizedRepositoryPath(cwd);
  if (planRunId(cwd) !== runId) return { acquired: false, reason: "plan_identity_mismatch" };

  const active = leaseDirectory(cwd);
  while (true) {
    const state = readLeaseDirectory(active);
    if (state.kind === "invalid") return raceLost(cwd);
    if (state.kind === "absent") {
      const recovery = recoverInterruptedTakeover(cwd);
      if (recovery === "restored") continue;
      if (recovery !== "none") return raceLost(cwd);

      const lease = createLease(controllerId, 1, dependencies.pid, runId, normalizedRepoPath, dependencies.now());
      if (planRunId(cwd) !== runId) return { acquired: false, reason: "plan_identity_mismatch" };
      const candidate = prepareLeaseDirectory(cwd, lease);
      if (planRunId(cwd) !== runId) {
        fs.rmSync(candidate, { recursive: true, force: true });
        return { acquired: false, reason: "plan_identity_mismatch" };
      }
      if (!publishLeaseDirectory(candidate, active)) return raceLost(cwd);
      if (planRunId(cwd) !== runId) return { acquired: false, reason: "plan_identity_mismatch", lease };
      return { acquired: true, reclaimed: false, lease };
    }

    const existing = state.lease;
    if (existing.normalizedRepoPath !== normalizedRepoPath) {
      return { acquired: false, reason: "repository_identity_mismatch", lease: existing };
    }
    if (planRunId(cwd) !== runId) {
      return { acquired: false, reason: "plan_identity_mismatch", lease: existing };
    }

    const releaseState = hasMatchingReleaseMarker(cwd, existing);
    if (releaseState === "invalid") return raceLost(cwd);
    if (
      existing.planRunId === runId
      && releaseState === "no"
      && dependencies.isProcessAlive(existing.pid)
    ) {
      return { acquired: false, reason: "live_owner", lease: existing };
    }

    const tombstone = tombstonePath(cwd, existing);
    try {
      fs.renameSync(active, tombstone);
    } catch {
      return raceLost(cwd);
    }

    if (planRunId(cwd) !== runId) {
      restorePriorGeneration(tombstone, active);
      return { acquired: false, reason: "plan_identity_mismatch", lease: existing };
    }

    const lease = createLease(
      controllerId,
      existing.leaseEpoch + 1,
      dependencies.pid,
      runId,
      normalizedRepoPath,
      dependencies.now(),
    );
    if (planRunId(cwd) !== runId) {
      restorePriorGeneration(tombstone, active);
      return { acquired: false, reason: "plan_identity_mismatch", lease: existing };
    }

    let candidate: string;
    try {
      candidate = prepareLeaseDirectory(cwd, lease);
    } catch (error) {
      restorePriorGeneration(tombstone, active);
      throw error;
    }
    if (planRunId(cwd) !== runId) {
      fs.rmSync(candidate, { recursive: true, force: true });
      restorePriorGeneration(tombstone, active);
      return { acquired: false, reason: "plan_identity_mismatch", lease: existing };
    }
    if (!publishLeaseDirectory(candidate, active)) return raceLost(cwd);
    if (planRunId(cwd) !== runId) {
      return { acquired: false, reason: "plan_identity_mismatch", lease };
    }
    return { acquired: true, reclaimed: true, lease };
  }
}

export function validateControllerLease(
  cwd: string,
  lease: ControllerLease,
  dependencies: Pick<LeaseDependencies, "isProcessAlive"> = defaultLeaseDependencies,
): boolean {
  let normalizedRepoPath: string;
  try {
    normalizedRepoPath = normalizedRepositoryPath(cwd);
  } catch {
    return false;
  }

  const current = readLeaseDirectory(leaseDirectory(cwd));
  return isControllerLease(lease)
    && current.kind === "valid"
    && sameLease(current.lease, lease)
    && lease.normalizedRepoPath === normalizedRepoPath
    && planRunId(cwd) === lease.planRunId
    && hasMatchingReleaseMarker(cwd, lease) === "no"
    && dependencies.isProcessAlive(lease.pid);
}

export function releaseControllerLease(cwd: string, lease: ControllerLease): void {
  const snapshot: ControllerLease = {
    version: lease.version,
    controllerId: lease.controllerId,
    leaseEpoch: lease.leaseEpoch,
    pid: lease.pid,
    planRunId: lease.planRunId,
    normalizedRepoPath: lease.normalizedRepoPath,
    acquiredAt: lease.acquiredAt,
  };
  if (!isControllerLease(snapshot)) return;
  atomicWriteJson(releaseMarkerPath(cwd, snapshot), snapshot);
}

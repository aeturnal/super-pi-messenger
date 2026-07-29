import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { normalize } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as crewStore from "../../crew/store.js";
import {
  acquireControllerLease,
  releaseControllerLease,
  validateControllerLease,
} from "../../crew/execution/lease.js";
import { atomicWriteJson, leaseDirectory } from "../../crew/execution/store.js";
import type { ControllerLease } from "../../crew/execution/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const otherRunId = "22222222-2222-4222-8222-222222222222";

function liveDeps(pid: number, livePids = new Set([pid])) {
  return { pid, now: () => now, isProcessAlive: (candidate: number) => livePids.has(candidate) };
}

function deadDeps(pid: number) {
  return liveDeps(pid, new Set<number>());
}

describe("controller lease", () => {
  let cwd: string;
  let normalizedCwd: string;

  beforeEach(() => {
    ({ cwd } = createTempCrewDirs());
    normalizedCwd = normalize(realpathSync(cwd));
    crewStore.createPlan(cwd, "PRD.md");
    crewStore.updatePlan(cwd, { run_id: runId });
  });

  function seedPlan(plan: { run_id: string }): void {
    const current = crewStore.getPlan(cwd);
    if (!current) throw new Error("missing test plan");
    atomicWriteJson(`${crewStore.getCrewDir(cwd)}/plan.json`, { ...current, ...plan });
  }

  function seedLease(overrides: Partial<ControllerLease>): ControllerLease {
    const lease: ControllerLease = {
      version: 1,
      controllerId: "controller-a",
      leaseEpoch: 1,
      pid: 101,
      planRunId: runId,
      normalizedRepoPath: normalizedCwd,
      acquiredAt: now,
      ...overrides,
    };
    mkdirSync(leaseDirectory(cwd), { recursive: true });
    atomicWriteJson(`${leaseDirectory(cwd)}/lease.json`, lease);
    atomicWriteJson(`${leaseDirectory(cwd)}/epoch.json`, { version: 1, leaseEpoch: lease.leaseEpoch });
    return lease;
  }

  it("grants one owner and makes a live compatible contender read-only", () => {
    const first = acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
    const second = acquireControllerLease(cwd, runId, "controller-b", liveDeps(202, new Set([101])));
    expect(first).toMatchObject({ acquired: true, lease: { leaseEpoch: 1 } });
    expect(second).toMatchObject({ acquired: false, reason: "live_owner" });
  });

  it("reclaims a dead compatible owner with a higher epoch", () => {
    acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
    const takeover = acquireControllerLease(cwd, runId, "controller-b", liveDeps(202, new Set()));
    expect(takeover).toMatchObject({ acquired: true, reclaimed: true, lease: { leaseEpoch: 2 } });
  });

  it("restores a complete interrupted takeover before retrying with a higher epoch", () => {
    const previous = seedLease({ controllerId: "controller-a", leaseEpoch: 1, pid: 101 });
    const tombstone = `${leaseDirectory(cwd)}.stale-${previous.controllerId}-${previous.leaseEpoch}`;
    renameSync(leaseDirectory(cwd), tombstone);

    const takeover = acquireControllerLease(cwd, runId, "controller-b", deadDeps(202));

    expect(takeover).toMatchObject({
      acquired: true,
      reclaimed: true,
      lease: { controllerId: "controller-b", leaseEpoch: 2 },
    });
    if (!takeover.acquired) throw new Error("expected recovered takeover");
    expect(validateControllerLease(cwd, takeover.lease, liveDeps(999, new Set([202])))).toBe(true);
  });

  it("keeps the observed generation tombstone as an ABA fence", () => {
    seedLease({ controllerId: "controller-a", leaseEpoch: 1, pid: 101 });
    let winner: ReturnType<typeof acquireControllerLease> | undefined;

    const staleContender = acquireControllerLease(cwd, runId, "controller-c", {
      pid: 303,
      now: () => now,
      isProcessAlive: pid => {
        if (pid === 101 && !winner) {
          winner = acquireControllerLease(cwd, runId, "controller-b", deadDeps(202));
        }
        return false;
      },
    });

    expect(winner).toMatchObject({ acquired: true, lease: { controllerId: "controller-b", leaseEpoch: 2 } });
    expect(staleContender).toMatchObject({ acquired: false, reason: "race_lost" });
    if (!winner?.acquired) throw new Error("expected winning takeover");
    expect(validateControllerLease(cwd, winner.lease, liveDeps(999, new Set([202])))).toBe(true);
    expect(acquireControllerLease(cwd, runId, "controller-d", liveDeps(404, new Set([202])))).toMatchObject({
      acquired: false,
      reason: "live_owner",
    });
  });

  it("fails closed on malformed active lease metadata", () => {
    const acquisition = acquireControllerLease(cwd, runId, "controller-b", {
      pid: 202,
      isProcessAlive: () => false,
      now: () => {
        seedLease({ pid: 0 });
        return now;
      },
    });

    expect(acquisition).toMatchObject({ acquired: false, reason: "race_lost" });
    expect(JSON.parse(readFileSync(`${leaseDirectory(cwd)}/lease.json`, "utf8")).pid).toBe(0);
  });

  it("fails closed when only a malformed stale generation remains", () => {
    const malformed = seedLease({ pid: 0 });
    renameSync(
      leaseDirectory(cwd),
      `${leaseDirectory(cwd)}.stale-${malformed.controllerId}-${malformed.leaseEpoch}`,
    );

    expect(acquireControllerLease(cwd, runId, "controller-b", deadDeps(202))).toMatchObject({
      acquired: false,
      reason: "race_lost",
    });
  });

  it("rechecks plan identity and restores a resumed takeover before returning", () => {
    const previous = seedLease({ controllerId: "controller-a", leaseEpoch: 1, pid: 101 });
    const tombstone = `${leaseDirectory(cwd)}.stale-${previous.controllerId}-${previous.leaseEpoch}`;
    renameSync(leaseDirectory(cwd), tombstone);

    const takeover = acquireControllerLease(cwd, runId, "controller-b", {
      pid: 202,
      isProcessAlive: () => false,
      now: () => {
        seedPlan({ run_id: otherRunId });
        return now;
      },
    });

    expect(takeover).toMatchObject({ acquired: false, reason: "plan_identity_mismatch" });
    expect(JSON.parse(readFileSync(`${leaseDirectory(cwd)}/lease.json`, "utf8"))).toMatchObject({
      controllerId: "controller-a",
      leaseEpoch: 1,
    });
  });

  it("replaces an incompatible prior-run lease only after confirming the current plan identity", () => {
    seedPlan({ run_id: otherRunId });
    seedLease({ planRunId: runId, normalizedRepoPath: normalizedCwd, pid: 101 });
    const nextRun = acquireControllerLease(cwd, otherRunId, "controller-b", liveDeps(202, new Set([101])));
    expect(nextRun).toMatchObject({ acquired: true, reclaimed: true, lease: { planRunId: otherRunId, leaseEpoch: 2 } });
  });

  it("refuses an unexpected repository identity in the repository-local lease", () => {
    seedLease({ planRunId: runId, normalizedRepoPath: "/other/repo", pid: 101 });
    expect(acquireControllerLease(cwd, runId, "controller-b", deadDeps(202))).toMatchObject({
      acquired: false, reason: "repository_identity_mismatch",
    });
  });

  it("does not release a lease owned by another controller or epoch", () => {
    const acquired = acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
    if (!acquired.acquired) throw new Error("expected test lease acquisition");

    releaseControllerLease(cwd, { ...acquired.lease, controllerId: "controller-b" });
    expect(validateControllerLease(cwd, acquired.lease, liveDeps(999, new Set([101])))).toBe(true);

    releaseControllerLease(cwd, { ...acquired.lease, leaseEpoch: 2 });
    expect(validateControllerLease(cwd, acquired.lease, liveDeps(999, new Set([101])))).toBe(true);

    releaseControllerLease(cwd, acquired.lease);
    expect(validateControllerLease(cwd, acquired.lease, liveDeps(999, new Set([101])))).toBe(false);
  });

  it("does not invalidate a successor that wins during release", () => {
    const acquired = acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
    if (!acquired.acquired) throw new Error("expected test lease acquisition");

    let racingTakeover: ReturnType<typeof acquireControllerLease> | undefined;
    const releasingLease = { ...acquired.lease };
    Object.defineProperty(releasingLease, "normalizedRepoPath", {
      get: () => {
        racingTakeover = acquireControllerLease(cwd, runId, "controller-b", deadDeps(202));
        return acquired.lease.normalizedRepoPath;
      },
    });

    releaseControllerLease(cwd, releasingLease);
    expect(racingTakeover).toMatchObject({
      acquired: true,
      lease: { controllerId: "controller-b", leaseEpoch: 2 },
    });
    if (!racingTakeover?.acquired) throw new Error("expected successor lease acquisition");
    expect(validateControllerLease(cwd, racingTakeover.lease, liveDeps(999, new Set([202])))).toBe(true);
  });

  it("invalidates authorization after plan deletion or run identity replacement", () => {
    const acquired = acquireControllerLease(cwd, runId, "controller-a", liveDeps(101));
    if (!acquired.acquired) throw new Error("expected test lease acquisition");
    const validationDeps = liveDeps(999, new Set([101]));

    rmSync(`${crewStore.getCrewDir(cwd)}/plan.json`);
    expect(validateControllerLease(cwd, acquired.lease, validationDeps)).toBe(false);

    crewStore.createPlan(cwd, "PRD.md");
    crewStore.updatePlan(cwd, { run_id: otherRunId });
    expect(validateControllerLease(cwd, acquired.lease, validationDeps)).toBe(false);
  });
});

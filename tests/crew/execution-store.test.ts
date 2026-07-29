import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as crewStore from "../../crew/store.js";
import {
  createAttempt, ensurePlanRunId, readAttempt, readSchedulerRecord,
  updateAttempt, writeSchedulerRecord,
} from "../../crew/execution/store.js";
import type { AttemptRecord, SchedulerRecord } from "../../crew/execution/types.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";

const now = "2026-07-28T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";

function idleRecord(controllerId = "controller-a"): SchedulerRecord {
  return {
    version: 1, runId, controllerId, leaseEpoch: 1, mode: "idle",
    waveSnapshotTaskIds: [], waveTargetState: {}, desiredConcurrencyOverride: null,
    activeAttemptIds: [], cancellationIntent: null,
  };
}

function seedLegacyPlan(crewDir: string, prd = "PRD.md"): void {
  writeFileSync(join(crewDir, "plan.json"), JSON.stringify({
    prd,
    created_at: now,
    updated_at: now,
    task_count: 0,
    completed_count: 0,
  }));
}

describe("execution persistence", () => {
  it("atomically adds one immutable run_id to a legacy plan", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    seedLegacyPlan(crewDir);
    const migrated = ensurePlanRunId(cwd, { uuid: () => runId, now: () => now });
    expect(migrated.run_id).toBe(runId);
    expect(ensurePlanRunId(cwd, { uuid: () => "22222222-2222-4222-8222-222222222222", now: () => now }).run_id).toBe(runId);
    expect(JSON.parse(readFileSync(join(crewDir, "plan.json"), "utf8")).run_id).toBe(runId);
  });

  it("gives interleaved migration contenders one persisted run_id", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    const contenderRunId = "22222222-2222-4222-8222-222222222222";
    seedLegacyPlan(crewDir);

    let contender: ReturnType<typeof ensurePlanRunId> | undefined;
    const first = ensurePlanRunId(cwd, {
      uuid: () => {
        contender = ensurePlanRunId(cwd, { uuid: () => contenderRunId, now: () => now });
        return runId;
      },
      now: () => now,
    });

    expect(first.run_id).toBe(contenderRunId);
    expect(contender?.run_id).toBe(contenderRunId);
    expect(JSON.parse(readFileSync(join(crewDir, "plan.json"), "utf8")).run_id).toBe(contenderRunId);
  });

  it("finishes migration from an immutable identity published before process death", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    seedLegacyPlan(crewDir);
    writeFileSync(join(crewDir, "run-id.json"), JSON.stringify({ version: 1, runId }));

    const migrated = ensurePlanRunId(cwd, {
      uuid: () => "22222222-2222-4222-8222-222222222222",
      now: () => now,
    });

    expect(migrated.run_id).toBe(runId);
    expect(JSON.parse(readFileSync(join(crewDir, "plan.json"), "utf8")).run_id).toBe(runId);
  });

  it("fails closed on malformed immutable identity metadata", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    seedLegacyPlan(crewDir);
    writeFileSync(join(crewDir, "run-id.json"), JSON.stringify({ version: 1, runId: "" }));

    expect(() => ensurePlanRunId(cwd, { uuid: () => runId, now: () => now })).toThrow(
      "Invalid run identity",
    );
    expect(crewStore.getPlan(cwd)?.run_id).toBeUndefined();
  });

  it("creates a new plan with a fresh persisted run_id", () => {
    const { cwd } = createTempCrewDirs();
    const created = crewStore.createPlan(cwd, "PRD.md");

    expect(created.run_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(crewStore.getPlan(cwd)?.run_id).toBe(created.run_id);
  });

  it.each(["legacy", "identified"] as const)(
    "refuses to overwrite an existing %s plan without changing its bytes or identity",
    kind => {
      const { cwd, crewDir } = createTempCrewDirs();
      seedLegacyPlan(crewDir);
      if (kind === "identified") {
        const planPath = join(crewDir, "plan.json");
        const identified = JSON.parse(readFileSync(planPath, "utf8"));
        writeFileSync(planPath, JSON.stringify({ ...identified, run_id: runId }));
      }
      const planPath = join(crewDir, "plan.json");
      const before = readFileSync(planPath, "utf8");
      const expectedRunId = kind === "identified" ? runId : undefined;

      expect(() => crewStore.createPlan(cwd, "NEXT.md")).toThrow("Crew plan already exists");

      expect(readFileSync(planPath, "utf8")).toBe(before);
      expect(crewStore.getPlan(cwd)?.run_id).toBe(expectedRunId);
    },
  );

  it("refuses replacement after a migrator takes its final legacy snapshot", () => {
    const { cwd, crewDir } = createTempCrewDirs();
    seedLegacyPlan(crewDir);

    const migrated = ensurePlanRunId(cwd, {
      uuid: () => runId,
      now: () => {
        const planPath = join(crewDir, "plan.json");
        const before = readFileSync(planPath, "utf8");
        expect(() => crewStore.createPlan(cwd, "NEXT.md")).toThrow("Crew plan already exists");
        expect(readFileSync(planPath, "utf8")).toBe(before);
        return now;
      },
    });

    expect(migrated).toMatchObject({ prd: "PRD.md", run_id: runId });
    expect(crewStore.getPlan(cwd)).toMatchObject({ prd: "PRD.md", run_id: runId });
  });

  it("round-trips the complete scheduler record", () => {
    const { cwd } = createTempCrewDirs();
    writeSchedulerRecord(cwd, idleRecord());
    expect(readSchedulerRecord(cwd)).toEqual(idleRecord());
  });

  it("guards attempt charging and rollback across reload", () => {
    const { cwd } = createTempCrewDirs();
    const attempt: AttemptRecord = {
      version: 1, attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId,
      taskId: "task-1", controllerId: "controller-a", leaseEpoch: 1,
      workerName: "worker-a", pid: 42, startedAt: now, state: "running",
      attemptCharged: true, rollbackApplied: false, cancellation: null,
    };
    createAttempt(cwd, attempt);
    updateAttempt(cwd, attempt.attemptId, current => ({ ...current, rollbackApplied: true }));
    expect(readAttempt(cwd, attempt.attemptId)?.rollbackApplied).toBe(true);
  });

  it("normalizes absent additive task fields without changing old status", () => {
    const { cwd, tasksDir } = createTempCrewDirs();
    crewStore.createPlan(cwd, "PRD.md");
    const task = crewStore.createTask(cwd, "Legacy");
    const path = join(tasksDir, `${task.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.current_attempt_id;
    delete raw.legacy_review_state;
    writeFileSync(path, JSON.stringify(raw));
    expect(crewStore.getTask(cwd, task.id)).toMatchObject({ status: "todo", attempt_count: 0 });
  });
});

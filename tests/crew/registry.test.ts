import { describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { hasActiveWorker, registerWorker, unregisterWorker } from "../../crew/registry.ts";

describe("crew/registry", () => {
  it("treats a proc as active until it has terminal state", () => {
    const { cwd } = createTempCrewDirs();
    const taskId = "task-1";

    const runningProc = {
      exitCode: null,
      killed: true,
      signalCode: null,
    } as ChildProcess;
    const signalTerminatedProc = {
      exitCode: null,
      killed: true,
      signalCode: "SIGTERM",
    } as ChildProcess;
    const exitedProc = {
      exitCode: 1,
      killed: true,
      signalCode: null,
    } as ChildProcess;

    const registerFixture = (proc: ChildProcess) =>
      registerWorker({
        type: "worker",
        cwd,
        taskId,
        name: "worker",
        proc,
      });

    registerFixture(runningProc);

    try {
      expect(hasActiveWorker(cwd, taskId)).toBe(true);

      registerFixture(signalTerminatedProc);
      expect(hasActiveWorker(cwd, taskId)).toBe(false);

      registerFixture(exitedProc);
      expect(hasActiveWorker(cwd, taskId)).toBe(false);
    } finally {
      unregisterWorker(cwd, taskId);
    }
  });
});

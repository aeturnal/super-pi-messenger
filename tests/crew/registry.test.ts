import { describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { hasActiveWorker, registerWorker, unregisterWorker } from "../../crew/registry.ts";

describe("crew/registry", () => {
  it("treats a proc as active until it has terminal state", () => {
    const { cwd } = createTempCrewDirs();
    const taskId = "task-1";

    const proc = {
      exitCode: null,
      killed: true,
      signalCode: null,
    } as ChildProcess;

    registerWorker({
      type: "worker",
      cwd,
      taskId,
      name: "worker",
      proc,
    });

    try {
      expect(hasActiveWorker(cwd, taskId)).toBe(true);

      proc.signalCode = "SIGTERM";
      expect(hasActiveWorker(cwd, taskId)).toBe(false);

      proc.signalCode = null;
      proc.exitCode = 1;
      expect(hasActiveWorker(cwd, taskId)).toBe(false);
    } finally {
      unregisterWorker(cwd, taskId);
    }
  });
});

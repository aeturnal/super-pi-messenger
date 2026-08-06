import { describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import {
  getAvailableLobbyWorkers,
  hasActiveWorker,
  registerWorker,
  unregisterWorker,
} from "../../crew/registry.ts";

describe("crew/registry", () => {
  it.each([
    ["healthy", { exitCode: null, signalCode: null, killed: false }, null, true],
    ["kill requested", { exitCode: null, signalCode: null, killed: true }, null, false],
    ["signal terminated", { exitCode: null, signalCode: "SIGTERM", killed: false }, null, false],
    ["exited", { exitCode: 1, signalCode: null, killed: true }, null, false],
    ["assigned", { exitCode: null, signalCode: null, killed: false }, "task-2", false],
  ])("filters %s lobby workers", (_label, processState, assignedTaskId, expected) => {
    const { cwd } = createTempCrewDirs();
    const taskId = "__lobby-test";
    const proc = processState as ChildProcess;

    registerWorker({
      type: "lobby",
      cwd,
      taskId,
      name: "LobbyWorker",
      proc,
      lobbyId: "test",
      assignedTaskId,
      managedByWork: false,
      coordination: "chatty",
      startedAt: 0,
      promptTmpDir: null,
      aliveFile: null,
      superpowersActive: false,
      completion: Promise.resolve({} as never),
      resolveCompletion: () => {},
    });

    try {
      expect(getAvailableLobbyWorkers(cwd).length > 0).toBe(expected);
    } finally {
      unregisterWorker(cwd, taskId);
    }
  });

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

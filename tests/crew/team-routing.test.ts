import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../../lib.js";
import { executeCrewAction } from "../../crew/index.js";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";
import { createMockContext } from "../helpers/mock-context.js";

function createState(): MessengerState {
  return { agentName: "AgentOne", registered: true } as MessengerState;
}

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, ".pi", "messenger");
  const registry = path.join(base, "registry");
  const inbox = path.join(base, "inbox");
  fs.mkdirSync(registry, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  return { base, registry, inbox };
}

describe("team command routing", () => {
  let cwd: string;
  let dirs: Dirs;
  let state: MessengerState;

  beforeEach(() => {
    cwd = createTempCrewDirs().cwd;
    process.env.PI_MESSENGER_TEAM_PROFILE_DIR = path.join(cwd, "profiles");
    dirs = createDirs(cwd);
    state = createState();
  });

  afterEach(() => {
    delete process.env.PI_MESSENGER_TEAM_PROFILE_DIR;
  });

  async function run(action: string, params: Record<string, unknown> = {}) {
    return executeCrewAction(action, { action, ...params }, state, dirs, createMockContext(cwd), () => {}, () => {}, vi.fn());
  }

  it("routes team commands", async () => {
    const invalid = await run("team.profile.use", { name: "../outside" });
    expect(invalid.details.error).toBe("invalid_name");

    expect((await run("team.profile.use", { name: "migration-squad" })).details.mode).toBe("team.profile.use");
    expect((await run("team.profile.list")).details.mode).toBe("team.profile.list");
    expect((await run("team.profile.save", { name: "saved-squad" })).details.mode).toBe("team.profile.save");
    expect((await run("team.charter.create", { name: "migration-squad", message: "Ship safely." })).details.mode).toBe("team.charter.create");
    expect((await run("team.charter.show")).details.mode).toBe("team.charter.show");
    expect((await run("team.charter.update", { message: "Prefer reviews." })).details.mode).toBe("team.charter.update");
    expect((await run("team.memory.note", { type: "decision", message: "Use JSON profiles." })).details.mode).toBe("team.memory.note");
    expect((await run("team.memory.list", { type: "decision" })).details.mode).toBe("team.memory.list");
    expect((await run("team.roles")).details.mode).toBe("team.roles");
    expect((await run("team.status")).details.mode).toBe("team.status");
  });
});

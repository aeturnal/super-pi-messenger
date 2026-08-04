import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Dirs, MessengerState } from "../../lib.ts";
import { executeCrewAction } from "../../crew/index.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";
import { createMockContext } from "../helpers/mock-context.ts";

const workExecute = vi.hoisted(() => vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], details: {} })));

vi.mock("../../crew/handlers/work.ts", () => ({ execute: workExecute }));

function createState(): MessengerState {
  return {
    agentName: "AgentOne", registered: true, watcher: null, watcherRetries: 0,
    watcherRetryTimer: null, watcherDebounceTimer: null, reservations: [],
    chatHistory: new Map(), unreadCounts: new Map(), broadcastHistory: [], seenSenders: new Map(),
    model: "stale-provider/stale-model", cwd: process.cwd(), gitBranch: undefined, spec: undefined,
    scopeToFolder: false, isHuman: false, session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() }, statusMessage: undefined, customStatus: false,
    registryFlushTimer: null, sessionStartedAt: new Date().toISOString(),
  };
}

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, ".pi", "messenger");
  const dirs = { base, registry: path.join(base, "registry"), inbox: path.join(base, "inbox") };
  fs.mkdirSync(dirs.registry, { recursive: true });
  fs.mkdirSync(dirs.inbox, { recursive: true });
  return dirs;
}

describe("Crew host model routing", () => {
  it("uses the current ExtensionContext model after a host model switch", async () => {
    const { cwd } = createTempCrewDirs();
    const ctx = createMockContext(cwd);
    const state = createState();
    ctx.model = { provider: "openai-codex", id: "gpt-5.6-terra" } as typeof ctx.model;

    await executeCrewAction("work", {}, state, createDirs(cwd), ctx, () => {}, () => {}, vi.fn());
    ctx.model = { provider: "anthropic", id: "claude-opus-4-6" } as typeof ctx.model;
    await executeCrewAction("work", {}, state, createDirs(cwd), ctx, () => {}, () => {}, vi.fn());

    expect(workExecute.mock.calls[0].at(-1)).toBe("openai-codex/gpt-5.6-terra");
    expect(workExecute.mock.calls[1].at(-1)).toBe("anthropic/claude-opus-4-6");
  });
});

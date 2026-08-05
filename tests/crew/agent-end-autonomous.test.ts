import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autonomousState, consumePendingAutoWork, startAutonomous } from "../../crew/state.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

vi.mock("@earendil-works/pi-tui", () => ({
  matchesKey: () => false,
  truncateToWidth: (value: string) => value,
  visibleWidth: (value: string) => value.length,
}));

vi.mock("../../crew/agents.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../../crew/agents.ts")>();
  return { ...actual, spawnAgents: vi.fn() };
});

vi.mock("typebox", () => ({
  Type: {
    Unsafe: (schema: unknown) => schema,
    Optional: (schema: unknown) => schema,
    String: (schema: unknown) => schema,
    Number: (schema: unknown) => schema,
    Boolean: (schema: unknown) => schema,
    Any: (schema: unknown) => schema,
    Array: (schema: unknown) => schema,
    Object: (schema: unknown) => schema,
  },
}));

function createMockPi() {
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>();
  const commands = new Map<string, { handler: (args: string[], ctx: any) => Promise<void> }>();

  return {
    handlers,
    commands,
    on: vi.fn((event: string, handler: (event: unknown, ctx: any) => unknown) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn((name: string, command: { handler: (args: string[], ctx: any) => Promise<void> }) => {
      commands.set(name, command);
    }),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    appendEntry: vi.fn(),
  };
}

function createEventContext(cwd: string, hasUI = false) {
  return {
    cwd,
    hasUI,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn(),
      theme: { fg: (_color: string, text: string) => text },
    },
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => "test-session",
    },
    model: { id: "test-model" },
  } as any;
}

function resetAutonomousState(): void {
  autonomousState.active = false;
  autonomousState.cwd = null;
  autonomousState.waveNumber = 0;
  autonomousState.waveHistory = [];
  autonomousState.startedAt = null;
  autonomousState.stoppedAt = null;
  autonomousState.stopReason = null;
  autonomousState.concurrency = 2;
  autonomousState.autoOverlayPending = false;
  autonomousState.pid = null;
}

describe("agent_end autonomous continuation guards", () => {
  const tempHomes: string[] = [];

  beforeEach(() => {
    resetAutonomousState();
    consumePendingAutoWork();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-home-"));
    tempHomes.push(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_MESSENGER_DIR", path.join(home, ".pi", "agent", "messenger"));
    vi.stubEnv("PI_CREW_WORKER", undefined);
    vi.stubEnv("PI_LOBBY_ID", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const home of tempHomes) {
      fs.rmSync(home, { force: true, recursive: true });
    }
    tempHomes.length = 0;
    consumePendingAutoWork();
  });

  it("starts default auto-work after a plan completes while the overlay is open", async () => {
    const { cwd } = createTempCrewDirs();
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "pi-messenger.json"), JSON.stringify({ autoRegister: true }));
    fs.writeFileSync(path.join(cwd, "docs", "PRD.md"), "# PRD\nBuild something");

    const ctx = createEventContext(cwd, true);
    ctx.ui.custom.mockImplementation((factory: any) => {
      factory({ requestRender: vi.fn() }, ctx.ui.theme, {}, vi.fn());
      return new Promise(() => {});
    });
    const pi = createMockPi();
    const { default: piMessengerExtension } = await import("../../index.ts");
    const planHandler = await import("../../crew/handlers/plan.ts");
    const { spawnAgents } = await import("../../crew/agents.ts");
    vi.mocked(spawnAgents).mockResolvedValue([{
      exitCode: 0,
      output: "## 1. PRD Understanding Summary\nSummary\n## 2. Relevant Code/Docs/Resources Reviewed\nResources\n## 3. Sequential Implementation Steps\nSteps\n## 4. Parallelized Task Graph\nGraph\n```tasks-json\n[{\"title\":\"Task A\",\"description\":\"Do A\",\"dependsOn\":[]}]\n```",
      error: null,
      progress: { toolCallCount: 0, tokens: 0 },
    }]);
    piMessengerExtension(pi as any);

    const sessionStart = pi.handlers.get("session_start")?.[0];
    const agentEndHandler = pi.handlers.get("agent_end")?.[0];
    const messengerCommand = pi.commands.get("messenger");
    expect(sessionStart).toBeTruthy();
    expect(agentEndHandler).toBeTruthy();
    expect(messengerCommand).toBeTruthy();

    await sessionStart?.({}, ctx);
    void messengerCommand?.handler([], ctx);
    await planHandler.execute({ action: "plan" }, ctx, "agent");
    await agentEndHandler?.({}, ctx);

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: "crew_auto_work" }),
      { triggerTurn: true, deliverAs: "steer" },
    );

    await pi.handlers.get("session_shutdown")?.[0]?.({}, ctx);
  });

  it("stops restored autonomous state when session is not registered", async () => {
    const { cwd } = createTempCrewDirs();
    const ctx = createEventContext(cwd);
    const pi = createMockPi();
    const { default: piMessengerExtension } = await import("../../index.ts");
    piMessengerExtension(pi as any);

    const agentEndHandler = pi.handlers.get("agent_end")?.[0];
    expect(agentEndHandler).toBeTruthy();

    startAutonomous(cwd, 2);
    expect(autonomousState.active).toBe(true);

    await agentEndHandler?.({}, ctx);

    expect(autonomousState.active).toBe(false);
    expect(autonomousState.stopReason).toBe("manual");
    expect(pi.appendEntry).toHaveBeenCalledWith("crew-state", autonomousState);
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("skips autonomous continuation handling inside worker sessions", async () => {
    const { cwd } = createTempCrewDirs();
    const ctx = createEventContext(cwd);
    const pi = createMockPi();
    const { default: piMessengerExtension } = await import("../../index.ts");
    piMessengerExtension(pi as any);

    const agentEndHandler = pi.handlers.get("agent_end")?.[0];
    expect(agentEndHandler).toBeTruthy();

    startAutonomous(cwd, 2);
    vi.stubEnv("PI_CREW_WORKER", "1");

    await agentEndHandler?.({}, ctx);

    expect(autonomousState.active).toBe(true);
    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});

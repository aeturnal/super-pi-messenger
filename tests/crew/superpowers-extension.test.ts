import type { Skill } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSuperpowersSkills,
  getSuperpowersState,
  prepareSuperpowersLaunch,
  resetSuperpowersStateForTests,
} from "../../crew/superpowers.js";
import { executeCrewAction } from "../../crew/index.js";

vi.mock("../../crew/index.js", () => ({
  executeCrewAction: vi.fn(),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  matchesKey: () => false,
  truncateToWidth: (value: string) => value,
  visibleWidth: (value: string) => value.length,
}));

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
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();

  return {
    handlers,
    on: vi.fn((event: string, handler: (event: any, ctx: any) => unknown) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    appendEntry: vi.fn(),
  };
}

async function loadExtension() {
  const pi = createMockPi();
  const { default: piMessengerExtension } = await import("../../index.js");
  piMessengerExtension(pi as any);
  return pi;
}

describe("Superpowers extension lifecycle", () => {
  beforeEach(() => {
    resetSuperpowersStateForTests();
    vi.clearAllMocks();
    vi.mocked(executeCrewAction).mockReset();
  });

  it("delivers one fallback warning through the next headless tool result", async () => {
    const candidate = {
      name: "using-superpowers",
      description: "Bootstrap Superpowers workflows",
      filePath: "/tmp/unverified/using-superpowers/SKILL.md",
      baseDir: "/tmp/unverified",
      sourceInfo: {
        path: "/tmp/unverified/using-superpowers/SKILL.md",
        source: "git:github.com/example/superpowers",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/unverified",
      },
      disableModelInvocation: true,
    } satisfies Skill;
    captureSuperpowersSkills([candidate]);
    prepareSuperpowersLaunch("worker", "task-1");

    const firstNonText = { type: "image", data: "image-data", mimeType: "image/png" };
    const laterText = { type: "text", text: "later text" };
    const details = { mode: "status", nested: { retained: true } };
    const crewResult = {
      content: [firstNonText, { type: "text", text: "native result" }, laterText],
      details,
    };
    vi.mocked(executeCrewAction).mockResolvedValue(crewResult as any);
    const pi = await loadExtension();
    const tool = pi.registerTool.mock.calls[0]?.[0] as any;
    const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify: vi.fn() } };

    const first = await tool.execute("first", { action: "status" }, undefined, undefined, ctx);
    const second = await tool.execute("second", { action: "status" }, undefined, undefined, ctx);

    expect(first.content[1]).toEqual({
      type: "text",
      text: expect.stringMatching(/^⚠ Superpowers integration fallback:/),
    });
    expect(first.content[1].text).toContain("\n\nnative result");
    expect(first.content[0]).toBe(firstNonText);
    expect(first.content[2]).toBe(laterText);
    expect(first.details).toBe(details);
    expect(second).toBe(crewResult);
    expect(second.content[1].text).toBe("native result");
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("also notifies in UI sessions without replacing result delivery", async () => {
    captureSuperpowersSkills([{
      name: "using-superpowers",
      description: "Bootstrap Superpowers workflows",
      filePath: "/tmp/unverified/using-superpowers/SKILL.md",
      baseDir: "/tmp/unverified",
      sourceInfo: {
        path: "/tmp/unverified/using-superpowers/SKILL.md",
        source: "git:github.com/example/superpowers",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/unverified",
      },
      disableModelInvocation: true,
    } satisfies Skill]);
    prepareSuperpowersLaunch("reviewer", "task-2");
    vi.mocked(executeCrewAction).mockResolvedValue({
      content: [{ type: "text", text: "native result" }],
      details: { mode: "review" },
    } as any);
    const pi = await loadExtension();
    const tool = pi.registerTool.mock.calls[0]?.[0] as any;
    const ctx = { cwd: process.cwd(), hasUI: true, ui: { notify: vi.fn() } };

    const result = await tool.execute("ui", { action: "status" }, undefined, undefined, ctx);

    expect(result.content[0].text).toMatch(/^⚠ Superpowers integration fallback:/);
    const warning = result.content[0].text.slice(2, -"\n\nnative result".length);
    expect(ctx.ui.notify).toHaveBeenCalledWith(warning, "warning");
  });

  it("captures Pi's loaded skill catalog before the agent starts", async () => {
    const candidate = {
      name: "using-superpowers",
      description: "Bootstrap Superpowers workflows",
      filePath: "/tmp/superpowers/skills/using-superpowers/SKILL.md",
      baseDir: "/tmp/superpowers",
      sourceInfo: {
        path: "/tmp/superpowers/skills/using-superpowers/SKILL.md",
        source: "git:github.com/example/superpowers",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/superpowers",
      },
      disableModelInvocation: true,
    } satisfies Skill;
    const pi = await loadExtension();
    const handlers = pi.handlers.get("before_agent_start") ?? [];

    expect(getSuperpowersState()).toEqual({ status: "inactive" });
    expect(handlers).toHaveLength(1);

    await handlers[0]?.({ systemPromptOptions: { skills: [candidate] } }, undefined);

    expect(getSuperpowersState()).toEqual({
      status: "fallback",
      reason: expect.stringContaining("official Superpowers provenance"),
      correctiveAction: "Install Superpowers from github.com/obra/superpowers.",
    });
  });
});

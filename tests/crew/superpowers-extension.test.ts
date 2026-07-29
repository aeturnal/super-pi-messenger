import type { Skill } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSuperpowersState,
  resetSuperpowersStateForTests,
} from "../../crew/superpowers.js";

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
  beforeEach(resetSuperpowersStateForTests);

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

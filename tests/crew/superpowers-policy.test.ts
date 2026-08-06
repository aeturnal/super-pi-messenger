import { afterEach, describe, expect, it, vi } from "vitest";
import piMessengerExtension from "../../index.js";
import {
  applySuperpowersOuterPolicy,
  SUPERPOWERS_OUTER_POLICY_MARKER,
} from "../../crew/superpowers-policy.js";
import type { SuperpowersState } from "../../crew/superpowers.js";
import { createStockSuperpowersFixture } from "../helpers/superpowers.js";

const activeState: SuperpowersState = {
  status: "active",
  version: "6.2.0",
  packageRoot: "/tmp/official-superpowers",
  skills: {
    "test-driven-development": {
      name: "test-driven-development",
      description: "Use RED-GREEN-REFACTOR",
      filePath: "/tmp/official-superpowers/skills/test-driven-development/SKILL.md",
    },
    "verification-before-completion": {
      name: "verification-before-completion",
      description: "Verify before completion",
      filePath: "/tmp/official-superpowers/skills/verification-before-completion/SKILL.md",
    },
  },
};

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

function applyPolicyWithEnv(env: Record<string, string>): string {
  for (const name of ["PI_CREW_WORKER", "PI_LOBBY_ID", "PI_CREW_ROLE"]) {
    vi.stubEnv(name, undefined);
  }
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }

  const fixture = createStockSuperpowersFixture();
  try {
    const pi = createMockPi();
    piMessengerExtension(pi as any);
    const handler = pi.handlers.get("before_agent_start")?.[0];
    if (!handler) throw new Error("before_agent_start handler was not registered");

    const result = handler({
      systemPrompt: "base prompt",
      systemPromptOptions: { skills: fixture.skills },
    }, {});
    return (result as { systemPrompt?: string } | undefined)?.systemPrompt ?? "base prompt";
  } finally {
    fixture.cleanup();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("packaged Superpowers controlling-agent policy", () => {
  it("authorizes Crew for applicable subagent-driven-development", () => {
    const result = applySuperpowersOuterPolicy("base prompt", activeState, false);

    expect(result).toContain(SUPERPOWERS_OUTER_POLICY_MARKER);
    expect(result).toContain("Crew is automatically authorized");
    expect(result).toContain("without requesting separate approval");
    expect(result).toContain("sole implementation and review dispatcher");
    expect(result).toContain("If Crew is unavailable");
    expect(result).toContain(
      "Otherwise, do not start Crew planning or autonomous work unless the user explicitly asks",
    );
  });

  it.each<SuperpowersState>([
    { status: "inactive" },
    {
      status: "fallback",
      reason: "unsupported version",
      correctiveAction: "Install official Superpowers v6.",
    },
  ])("leaves prompts unchanged for $status state", (state) => {
    expect(applySuperpowersOuterPolicy("base prompt", state, false)).toBe("base prompt");
  });

  it("leaves Crew child prompts unchanged", () => {
    expect(applySuperpowersOuterPolicy("base prompt", activeState, true)).toBe("base prompt");
  });

  it("suppresses the outer policy for every Crew child marker", () => {
    const childMarkers: Array<Record<string, string>> = [
      { PI_CREW_ROLE: "planner" },
      { PI_CREW_ROLE: "analyst" },
      { PI_CREW_ROLE: "worker" },
      { PI_CREW_ROLE: "reviewer" },
      { PI_LOBBY_ID: "lobby-1" },
    ];
    for (const env of childMarkers) {
      expect(applyPolicyWithEnv(env)).not.toContain(SUPERPOWERS_OUTER_POLICY_MARKER);
    }
  });

  it("is idempotent", () => {
    const once = applySuperpowersOuterPolicy("base prompt", activeState, false);
    expect(applySuperpowersOuterPolicy(once, activeState, false)).toBe(once);
  });
});

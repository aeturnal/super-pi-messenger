import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import registerSuperpowersGuard, {
  LEGACY_POLICY_MARKER,
  SUPERPOWERS_CHILD_FLAG,
  STOCK_BOOTSTRAP_MARKER,
  stripLegacyPolicy,
  stripStockBootstrap,
} from "../../crew/superpowers-guard.js";

type RegisteredHandler = (event: any, context?: any) => unknown;

function captureHandlers(): {
  pi: ExtensionAPI;
  handlers: Map<string, RegisteredHandler[]>;
} {
  const handlers = new Map<string, RegisteredHandler[]>();
  const pi = {
    on: vi.fn((event: string, handler: RegisteredHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
  } as unknown as ExtensionAPI;

  return { pi, handlers };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Superpowers child guidance markers", () => {
  it("removes whole messages with the exact stock marker and preserves retained identities", () => {
    const before = { role: "user", content: "before" };
    const markedString = {
      role: "custom",
      content: `prefix ${STOCK_BOOTSTRAP_MARKER} suffix`,
    };
    const markedTextPart = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: STOCK_BOOTSTRAP_MARKER },
        { type: "text", text: `prefix ${STOCK_BOOTSTRAP_MARKER} suffix` },
      ],
    };
    const approximate = {
      role: "custom",
      content: "superpowers using-superpowers bootstrap for pi",
    };
    const thinkingOnly = {
      role: "assistant",
      content: [{ type: "thinking", thinking: STOCK_BOOTSTRAP_MARKER }],
    };
    const after = { role: "assistant", content: [{ type: "text", text: "after" }] };

    const result = stripStockBootstrap([
      before,
      markedString,
      markedTextPart,
      approximate,
      thinkingOnly,
      after,
    ]);

    expect(result).toEqual([before, approximate, thinkingOnly, after]);
    expect(result[0]).toBe(before);
    expect(result[1]).toBe(approximate);
    expect(result[2]).toBe(thinkingOnly);
    expect(result[3]).toBe(after);
  });

  it("strips only the suffix beginning at the exact legacy marker", () => {
    const prefix = "system prompt\n";
    const prompt = `${prefix}${LEGACY_POLICY_MARKER}legacy guidance -->`;

    expect(stripLegacyPolicy(prompt)).toBe(prefix);
  });

  it("returns the original system prompt when the exact legacy marker is absent", () => {
    const prompt = "system prompt\n<!-- crew superpowers policy:";

    expect(stripLegacyPolicy(prompt)).toBe(prompt);
  });
});

describe("Superpowers child guard activation", () => {
  it.each([
    [undefined, "worker"],
    ["0", "worker"],
    ["true", "reviewer"],
    ["1", undefined],
    ["1", "planner"],
  ])("registers no handlers for flag %s and role %s", (flag, role) => {
    vi.stubEnv(SUPERPOWERS_CHILD_FLAG, flag);
    vi.stubEnv("PI_CREW_ROLE", role);
    const { pi, handlers } = captureHandlers();

    registerSuperpowersGuard(pi);

    expect(handlers.size).toBe(0);
  });

  it.each(["worker", "reviewer"])(
    "registers the two guidance guards for an active %s child",
    (role) => {
      vi.stubEnv(SUPERPOWERS_CHILD_FLAG, "1");
      vi.stubEnv("PI_CREW_ROLE", role);
      const { pi, handlers } = captureHandlers();

      registerSuperpowersGuard(pi);

      expect([...handlers.keys()]).toEqual(["before_agent_start", "context"]);
      expect(handlers.get("before_agent_start")).toHaveLength(1);
      expect(handlers.get("context")).toHaveLength(1);
    },
  );

  it("returns Pi's event result shapes from active handlers", () => {
    vi.stubEnv(SUPERPOWERS_CHILD_FLAG, "1");
    vi.stubEnv("PI_CREW_ROLE", "worker");
    const { pi, handlers } = captureHandlers();
    registerSuperpowersGuard(pi);
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];
    const context = handlers.get("context")?.[0];
    if (!beforeAgentStart || !context) throw new Error("guard handlers were not registered");

    expect(beforeAgentStart({
      systemPrompt: `base${LEGACY_POLICY_MARKER}legacy`,
    })).toEqual({ systemPrompt: "base" });

    const retained = { role: "user", content: "keep" };
    expect(context({
      messages: [
        retained,
        { role: "custom", content: STOCK_BOOTSTRAP_MARKER },
      ],
    })).toEqual({ messages: [retained] });
  });
});

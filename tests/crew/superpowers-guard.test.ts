import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import registerSuperpowersGuard, {
  LEGACY_POLICY_MARKER,
  SUPERPOWERS_CHILD_FLAG,
  STOCK_BOOTSTRAP_MARKER,
  stripLegacyPolicy,
  stripStockBootstrap,
} from "../../crew/superpowers-guard.js";

type MaybePromise<T> = T | Promise<T>;
type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
) => MaybePromise<BeforeAgentStartEventResult | void>;
type ContextHandler = (
  event: ContextEvent,
) => MaybePromise<{ messages?: ContextEvent["messages"] } | void>;
type GuardRegistration =
  | [event: "before_agent_start", handler: BeforeAgentStartHandler]
  | [event: "context", handler: ContextHandler];

type CapturedHandlers = {
  before_agent_start: BeforeAgentStartHandler[];
  context: ContextHandler[];
};

function captureHandlers(): { pi: ExtensionAPI; handlers: CapturedHandlers } {
  const handlers: CapturedHandlers = {
    before_agent_start: [],
    context: [],
  };
  const pi: Partial<ExtensionAPI> = {};
  Object.assign(pi, {
    on: vi.fn((...registration: GuardRegistration) => {
      if (registration[0] === "before_agent_start") {
        handlers.before_agent_start.push(registration[1]);
      } else {
        handlers.context.push(registration[1]);
      }
    }),
  });

  return { pi: pi as ExtensionAPI, handlers };
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

    const typedMessages: ContextEvent["messages"] = [];
    const typedResult: ContextEvent["messages"] = stripStockBootstrap(typedMessages);
    expect(typedResult).toEqual([]);
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

    expect(handlers.before_agent_start).toHaveLength(0);
    expect(handlers.context).toHaveLength(0);
  });

  it.each(["worker", "reviewer"])(
    "registers the two guidance guards for an active %s child",
    (role) => {
      vi.stubEnv(SUPERPOWERS_CHILD_FLAG, "1");
      vi.stubEnv("PI_CREW_ROLE", role);
      const { pi, handlers } = captureHandlers();

      registerSuperpowersGuard(pi);

      expect(handlers.before_agent_start).toHaveLength(1);
      expect(handlers.context).toHaveLength(1);
    },
  );

  it("returns Pi's event result shapes from active handlers", async () => {
    vi.stubEnv(SUPERPOWERS_CHILD_FLAG, "1");
    vi.stubEnv("PI_CREW_ROLE", "worker");
    const { pi, handlers } = captureHandlers();
    registerSuperpowersGuard(pi);
    const beforeAgentStart = handlers.before_agent_start[0];
    const context = handlers.context[0];
    if (!beforeAgentStart || !context) throw new Error("guard handlers were not registered");

    expect(await beforeAgentStart({
      type: "before_agent_start",
      prompt: "",
      systemPrompt: `base${LEGACY_POLICY_MARKER}legacy`,
      systemPromptOptions: { cwd: process.cwd() },
    })).toEqual({ systemPrompt: "base" });

    const retained: ContextEvent["messages"][number] = {
      role: "custom",
      customType: "test",
      content: "keep",
      display: false,
      timestamp: 0,
    };
    const marked: ContextEvent["messages"][number] = {
      role: "custom",
      customType: "test",
      content: STOCK_BOOTSTRAP_MARKER,
      display: false,
      timestamp: 0,
    };
    expect(await context({
      type: "context",
      messages: [retained, marked],
    })).toEqual({ messages: [retained] });
  });
});

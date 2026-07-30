import { describe, expect, it } from "vitest";
import {
  applySuperpowersOuterPolicy,
  SUPERPOWERS_OUTER_POLICY_MARKER,
} from "../../crew/superpowers-policy.js";
import type { SuperpowersState } from "../../crew/superpowers.js";

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

  it("is idempotent", () => {
    const once = applySuperpowersOuterPolicy("base prompt", activeState, false);
    expect(applySuperpowersOuterPolicy(once, activeState, false)).toBe(once);
  });
});

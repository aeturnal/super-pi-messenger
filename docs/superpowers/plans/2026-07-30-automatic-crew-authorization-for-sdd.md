# Packaged Automatic Crew Authorization for SDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship default-on packaged Crew authorization whenever the controlling Pi agent determines that official stock Superpowers `subagent-driven-development` applies.

**Architecture:** A focused `crew/superpowers-policy.ts` module renders and idempotently applies the controlling-agent policy after the existing provenance validator returns active official v6 state. `index.ts` integrates it into `before_agent_start`, while the child guard strips only the package-owned marker as defense in depth.

**Tech Stack:** TypeScript, Pi extension lifecycle API, Vitest, GitHub Actions

## Global Constraints

- Do not modify stock Superpowers files.
- Activate only for validated official Superpowers major version 6.
- Preserve silent inactive behavior and actionable fallback behavior.
- Crew remains the sole implementation and review dispatcher.
- Do not add a scheduler, event detector, session flag, command hook, automatic tool invocation, provider registry, or configuration subsystem.
- Add no compatibility, detection, replacement, warning, or migration logic for `~/.pi/agent/extensions/crew-superpowers-policy.ts`.
- Remove the standalone extension only after the packaged revision is merged, installed, and ready for live acceptance.
- Preserve unrelated untracked files and the dirty Phase 1A worktree unchanged.
- Use a pull request and merge only after the required `test-and-typecheck` GitHub check passes.

## Execution Setup

Create an isolated feature worktree from current `main`, not from `docs/integration-mvp-design`. Copy the final approved spec and this plan into that worktree without cherry-picking the superseded local-only documentation history. Commit the two final documents in the feature branch before implementation.

---

### Task 1: Add the packaged controlling-agent policy

**Files:**

- Create: `crew/superpowers-policy.ts`
- Create: `tests/crew/superpowers-policy.test.ts`

**Interfaces:**

- Consumes: `SuperpowersState` from `crew/superpowers.ts`
- Produces: `SUPERPOWERS_OUTER_POLICY_MARKER: string`
- Produces: `applySuperpowersOuterPolicy(systemPrompt: string, state: SuperpowersState, isCrewChild: boolean): string`

- [ ] **Step 1: Write the failing policy tests**

Create `tests/crew/superpowers-policy.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: FAIL because `crew/superpowers-policy.ts` does not exist.

- [ ] **Step 3: Implement the minimal packaged policy**

Create `crew/superpowers-policy.ts`:

```typescript
import type { SuperpowersState } from "./superpowers.js";

export const SUPERPOWERS_OUTER_POLICY_MARKER =
  "<!-- super-pi-messenger:superpowers-outer-policy-v1 -->";

const OUTER_POLICY = `## Crew and Superpowers compatibility policy

Outside Crew, Superpowers owns development workflow and methodology. pi-messenger messaging, presence, and reservation tools remain available.

Whenever \`subagent-driven-development\` is applicable, selected, or loaded, Crew is automatically authorized. Translate its implementer and reviewer workflow into Crew planning and work, use Crew as the sole implementation and review dispatcher, and proceed without requesting separate approval. Do not start nested agents, alternative subagent mechanisms, nested plan executors, branch-finishing workflows, or nested worktree management. If Crew is unavailable, report that condition instead of substituting another dispatcher.

Otherwise, do not start Crew planning or autonomous work unless the user explicitly asks to use Crew.`;

export function applySuperpowersOuterPolicy(
  systemPrompt: string,
  state: SuperpowersState,
  isCrewChild: boolean,
): string {
  if (
    state.status !== "active"
    || isCrewChild
    || systemPrompt.includes(SUPERPOWERS_OUTER_POLICY_MARKER)
  ) {
    return systemPrompt;
  }

  return `${systemPrompt}\n\n${SUPERPOWERS_OUTER_POLICY_MARKER}\n${OUTER_POLICY}`;
}
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts
```

Expected: 5 tests pass with no failures.

- [ ] **Step 5: Run TypeScript diagnostics on the new files**

Run Pi LSP diagnostics on:

```text
crew/superpowers-policy.ts
tests/crew/superpowers-policy.test.ts
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit Task 1**

```bash
git add crew/superpowers-policy.ts tests/crew/superpowers-policy.test.ts
git commit -m "feat: add packaged Crew authorization policy"
```

---

### Task 2: Integrate the policy lifecycle and package-owned child guard

**Files:**

- Modify: `index.ts:69,819-821`
- Modify: `crew/superpowers-guard.ts:1-43`
- Modify: `tests/crew/superpowers-guard.test.ts`
- Modify: `tests/crew/superpowers-extension.test.ts`

**Interfaces:**

- Consumes: `applySuperpowersOuterPolicy()` and `SUPERPOWERS_OUTER_POLICY_MARKER` from Task 1
- Preserves: `SUPERPOWERS_CHILD_FLAG = "PI_CREW_SUPERPOWERS_MVP"`
- Produces: `stripSuperpowersOuterPolicy(systemPrompt: string): string`

- [ ] **Step 1: Update child-guard tests for the package-owned marker**

In `tests/crew/superpowers-guard.test.ts`, replace imports of `LEGACY_POLICY_MARKER` and `stripLegacyPolicy` with:

```typescript
import { SUPERPOWERS_OUTER_POLICY_MARKER } from "../../crew/superpowers-policy.js";
import registerSuperpowersGuard, {
  SUPERPOWERS_CHILD_FLAG,
  STOCK_BOOTSTRAP_MARKER,
  stripStockBootstrap,
  stripSuperpowersOuterPolicy,
} from "../../crew/superpowers-guard.js";
```

Replace the two legacy-marker unit tests with:

```typescript
it("strips only the suffix beginning at the exact packaged marker", () => {
  const prefix = "system prompt\n";
  const prompt = `${prefix}${SUPERPOWERS_OUTER_POLICY_MARKER}\npackaged guidance`;

  expect(stripSuperpowersOuterPolicy(prompt)).toBe(prefix);
});

it("returns the original prompt when the packaged marker is absent", () => {
  const prompt = "system prompt\n<!-- super pi messenger policy -->";

  expect(stripSuperpowersOuterPolicy(prompt)).toBe(prompt);
});
```

Update the active-handler event fixture to use:

```typescript
systemPrompt: `base${SUPERPOWERS_OUTER_POLICY_MARKER}\npackaged guidance`,
```

- [ ] **Step 2: Add a failing extension-lifecycle test**

In `tests/crew/superpowers-extension.test.ts`, import:

```typescript
import { SUPERPOWERS_OUTER_POLICY_MARKER } from "../../crew/superpowers-policy.js";
import { SUPERPOWERS_CHILD_FLAG } from "../../crew/superpowers-guard.js";
import { createStockSuperpowersFixture } from "../helpers/superpowers.js";
```

Add this test:

```typescript
it("injects packaged outer policy after validating the loaded catalog", async () => {
  vi.stubEnv(SUPERPOWERS_CHILD_FLAG, "0");
  const fixture = createStockSuperpowersFixture();

  try {
    const pi = await loadExtension();
    const handlers = pi.handlers.get("before_agent_start") ?? [];

    expect(handlers).toHaveLength(1);
    const result = await handlers[0]?.({
      systemPrompt: "base prompt",
      systemPromptOptions: { skills: fixture.skills },
    }, undefined);

    expect(result).toEqual({
      systemPrompt: expect.stringContaining(SUPERPOWERS_OUTER_POLICY_MARKER),
    });
    expect(getSuperpowersState()).toMatchObject({ status: "active", version: "6.2.0" });
  } finally {
    fixture.cleanup();
  }
});
```

Add `vi.unstubAllEnvs()` to the existing `beforeEach` so the child flag cannot leak between tests.

Update the existing `"captures Pi's loaded skill catalog before the agent starts"` handler invocation so its event includes the current prompt:

```typescript
await handlers[0]?.({
  systemPrompt: "base prompt",
  systemPromptOptions: { skills: [candidate] },
}, undefined);
```

Its fallback-state expectation remains unchanged.

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
npm test -- tests/crew/superpowers-guard.test.ts tests/crew/superpowers-extension.test.ts
```

Expected failures:

- `stripSuperpowersOuterPolicy` is not exported.
- The lifecycle handler returns no packaged policy.

- [ ] **Step 4: Replace legacy child-marker handling**

In `crew/superpowers-guard.ts`, import the packaged marker:

```typescript
import { SUPERPOWERS_OUTER_POLICY_MARKER } from "./superpowers-policy.js";
```

Remove `LEGACY_POLICY_MARKER` and replace `stripLegacyPolicy` with:

```typescript
export function stripSuperpowersOuterPolicy(systemPrompt: string): string {
  const markerIndex = systemPrompt.indexOf(SUPERPOWERS_OUTER_POLICY_MARKER);
  return markerIndex === -1 ? systemPrompt : systemPrompt.slice(0, markerIndex);
}
```

Update the active `before_agent_start` guard to call `stripSuperpowersOuterPolicy`.

Do not change `stripStockBootstrap`, child activation conditions, or context-message filtering.

- [ ] **Step 5: Integrate policy application into the main extension lifecycle**

In `index.ts`, add:

```typescript
import { applySuperpowersOuterPolicy } from "./crew/superpowers-policy.js";
import { SUPERPOWERS_CHILD_FLAG } from "./crew/superpowers-guard.js";
```

Replace the existing capture-only lifecycle handler with:

```typescript
pi.on("before_agent_start", (event) => {
  const superpowersState = captureSuperpowersSkills(event.systemPromptOptions.skills ?? []);
  const systemPrompt = applySuperpowersOuterPolicy(
    event.systemPrompt,
    superpowersState,
    process.env[SUPERPOWERS_CHILD_FLAG] === "1",
  );

  return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
});
```

- [ ] **Step 6: Run the focused tests to verify GREEN**

Run:

```bash
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/superpowers-guard.test.ts tests/crew/superpowers-extension.test.ts
```

Expected: all focused tests pass with no failures.

- [ ] **Step 7: Run TypeScript diagnostics on all Task 2 files**

Run Pi LSP diagnostics on:

```text
index.ts
crew/superpowers-guard.ts
tests/crew/superpowers-guard.test.ts
tests/crew/superpowers-extension.test.ts
```

Expected: no TypeScript errors.

- [ ] **Step 8: Commit Task 2**

```bash
git add index.ts crew/superpowers-guard.ts tests/crew/superpowers-guard.test.ts tests/crew/superpowers-extension.test.ts
git commit -m "feat: authorize Crew for Superpowers SDD"
```

---

### Task 3: Document packaged behavior and complete repository verification

**Files:**

- Modify: `README.md:48-57`
- Modify: `CHANGELOG.md:3-13`

**Interfaces:**

- Documents: default-on controlling-agent authorization
- Documents: stock Superpowers remains separate
- Documents: no standalone policy extension is supported or required

- [ ] **Step 1: Update the README integration section**

Replace the legacy migration bullet with these bullets:

```markdown
- When the controlling Pi agent determines that stock `subagent-driven-development` applies, Crew is automatically authorized as the sole implementation and review dispatcher; no separate Crew confirmation is required.
- The packaged policy activates only for a validated official Superpowers v6 installation and is not injected into Crew workers or reviewers.
- No standalone `crew-superpowers-policy.ts` extension is required or supported.
```

Keep the existing worker/reviewer mappings, silent absence, fallback behavior, and independent-maintenance disclaimer.

- [ ] **Step 2: Add the Unreleased changelog entry**

Under `## [Unreleased]`, add an `### Added` section before `### Fixed`:

```markdown
### Added
- Packaged automatic Crew authorization when the controlling Pi agent determines that official Superpowers v6 `subagent-driven-development` applies, while preserving Crew-only dispatch and child isolation.
```

- [ ] **Step 3: Run documentation and focused checks**

Run:

```bash
git diff --check
npm test -- tests/crew/superpowers-policy.test.ts tests/crew/superpowers-guard.test.ts tests/crew/superpowers-extension.test.ts
```

Expected: diff check exits `0`; all focused tests pass.

- [ ] **Step 4: Commit Task 3**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: explain automatic Crew authorization"
```

- [ ] **Step 5: Run the full local CI equivalent**

Run:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check main...HEAD
```

Expected:

- all Vitest files and tests pass;
- TypeScript exits `0` with no diagnostics;
- diff check exits `0`.

- [ ] **Step 6: Run Pi diagnostics**

Run Pi LSP diagnostics on every changed TypeScript file, then run Pi Lens `mode=all` for all edited files.

Expected: no blocking errors or warnings.

- [ ] **Step 7: Perform independent code review**

Review the complete `main...HEAD` diff against the approved specification. Fix every Critical or Important finding, rerun the covering tests, and re-review the fix diff once.

Expected: specification compliance and code quality both approved, with no unresolved blocking findings.

---

## Pull Request and Release Gate

After all tasks and independent review pass:

1. Push the feature branch to `origin`.
2. Open a pull request against `main` with the behavior summary and local verification evidence.
3. Wait for the required `test-and-typecheck` GitHub Actions check.
4. If CI fails, diagnose the failure, apply a bounded fix with a failing test when behavior changes, rerun local verification, push, and wait for CI again.
5. Merge the pull request only after the required check succeeds.
6. Confirm local and remote `main` resolve to the merge commit.
7. Update the installed Git package to merged `main`.
8. Remove `~/.pi/agent/extensions/crew-superpowers-policy.ts`.
9. Start a fresh Pi session and perform supervised active acceptance: applicable `subagent-driven-development` proceeds through Crew without separate authorization and no nested dispatcher is launched.
10. Perform a negative acceptance check: a request where `subagent-driven-development` does not apply does not start Crew without an explicit user request.

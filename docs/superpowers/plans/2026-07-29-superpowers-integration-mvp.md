# Superpowers Integration MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give existing Crew workers and reviewers compact guidance from a separately installed official stock Superpowers package while preserving native pi-messenger behavior on absence or incompatibility.

**Architecture:** Capture Pi's authoritative loaded skill metadata in the parent extension, evaluate it with one concrete in-process adapter, and append a complete role selection at the existing `spawnAgents()` boundary. Add one final child-only extension that removes only the marked stock bootstrap and marked legacy policy suffix for active Crew children; expose in-memory state through existing status and warning paths.

**Tech Stack:** TypeScript, Pi extension lifecycle APIs, Node.js filesystem/Git process APIs, Vitest, existing Crew spawn/status/result helpers.

## Global Constraints

- Keep the implementation concrete and small: no provider interface, registry, scheduler, process manager, migration framework, persistence layer, or new configuration subsystem.
- Support only existing `worker` and `reviewer` Crew roles in this MVP.
- Worker starting skills are exactly `test-driven-development` and `verification-before-completion`; reviewer starting skill is exactly `verification-before-completion`.
- Stock Superpowers remains separately installed; do not copy or modify any Superpowers skill or extension file.
- Accept official `obra/superpowers` Git package metadata and identifiable local Git checkouts whose `origin` is official `obra/superpowers`.
- Initially support Superpowers major version `6` only.
- Other Pi-loaded user, project, and package skills remain available.
- Prohibit starting nested orchestration and creating, switching to, or managing nested worktrees; operating inside the checkout assigned by Crew remains allowed.
- Missing Superpowers is silent. Incomplete, shadowed, ambiguous, or incompatible Superpowers produces complete native fallback with one actionable warning.
- Do not change task, plan, scheduler, attempt, review, repair, recovery, artifact, routing, or planner semantics.
- Do not cherry-pick or merge the experimental Phase 1A execution branch.
- Execute this plan in an isolated worktree created with the `using-git-worktrees` skill.
- Every task uses focused RED/GREEN verification, one reviewer gate, and one commit.

## File Structure

- Create `crew/superpowers.ts` — concrete discovery, compatibility, role selection, rendering, warning deduplication, and latest in-memory launch state.
- Create `crew/superpowers-guard.ts` — final child-only Pi extension plus pure marker-removal helpers.
- Modify `crew/agents.ts` — apply a complete active selection at the existing launch boundary; do nothing in inactive/fallback.
- Modify `index.ts` — capture authoritative `Skill[]` and attach pending fallback warnings to tool results.
- Modify `crew/handlers/status.ts` — append compact adapter status and structured details.
- Modify `README.md` — explain automatic activation, Crew/Superpowers ownership, fallback, and other-skill availability.
- Create `tests/crew/superpowers.test.ts` — adapter discovery, provenance, selection, rendering, fallback, and warning tests.
- Create `tests/crew/superpowers-launch.test.ts` — spawn argument, environment, prompt, project override, and native fallback tests.
- Create `tests/crew/superpowers-guard.test.ts` — exact child marker filtering tests.
- Create `tests/crew/superpowers-extension.test.ts` — Pi lifecycle capture and non-interactive warning delivery tests.
- Modify `tests/crew/status.test.ts` — active/inactive/fallback status assertions.
- Create `evals/definitions/integration-mvp.md` — fixed supervised MVP acceptance contract.
- Create `evals/fixtures/integration-mvp/seed/` — one deterministic preplanned worker/reviewer fixture with one unrelated project skill.
- Create `evals/scripts/reset-integration-mvp.mjs` — safe reset only; never launches Pi or a model.
- Create `evals/scripts/verify-integration-mvp.mjs` — deterministic repository, task-state, worktree, and JSONL evidence checks.
- Create `evals/results/integration-mvp-TEMPLATE.md` — compact supervised result record.
- Create `tests/evals/integration-mvp.test.ts` — reset/verifier safety and contract tests.
- Modify `evals/README.md` — exact human-supervised commands and evidence boundaries.

---

### Task 1: Concrete Superpowers adapter

**Files:**

- Create: `crew/superpowers.ts`
- Create: `tests/crew/superpowers.test.ts`

**Interfaces:**

- Consumes: Pi `Skill` records from `@earendil-works/pi-coding-agent`.
- Produces:

```ts
export type SupportedSuperpowersRole = "worker" | "reviewer";
export type SuperpowersState =
  | { status: "inactive" }
  | { status: "fallback"; reason: string; correctiveAction: string; version?: string }
  | {
      status: "active";
      version: string;
      packageRoot: string;
      skills: Record<"test-driven-development" | "verification-before-completion", SkillRef>;
    };

export interface SkillRef {
  name: string;
  description: string;
  filePath: string;
}

export interface SuperpowersSelectionRecord {
  status: "active";
  role: SupportedSuperpowersRole;
  assignmentId?: string;
  packageVersion: string;
  packageRoot: string;
  selectedSkills: Array<SkillRef & { reason: string }>;
  prohibitedWorkflows: string[];
}

export function captureSuperpowersSkills(skills: readonly Skill[]): SuperpowersState;
export function getSuperpowersState(): SuperpowersState;
export function prepareSuperpowersLaunch(
  role: string,
  assignmentId?: string,
): SuperpowersSelectionRecord | undefined;
export function renderSuperpowersGuidance(record: SuperpowersSelectionRecord): string;
export function renderSuperpowersStatus(): string;
export function getSuperpowersStatusDetails(): Record<string, unknown>;
export function takeSuperpowersWarning(): string | undefined;
export function resetSuperpowersStateForTests(): void;
```

- [ ] **Step 1: Write the failing adapter tests**

Create a real temporary package root per test. Use canonical files rather than mocking Node filesystem behavior:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
  captureSuperpowersSkills,
  getSuperpowersState,
  prepareSuperpowersLaunch,
  renderSuperpowersGuidance,
  resetSuperpowersStateForTests,
  takeSuperpowersWarning,
} from "../../crew/superpowers.js";

const roots: string[] = [];

function writeStockRoot(source = "git:github.com/obra/superpowers"): { root: string; skills: Skill[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superpowers-adapter-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".pi", "extensions"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "superpowers", version: "6.2.0" }));
  fs.writeFileSync(
    path.join(root, ".pi", "extensions", "superpowers.ts"),
    'const marker = "superpowers:using-superpowers bootstrap for pi";\n',
  );
  const names = ["using-superpowers", "test-driven-development", "verification-before-completion"];
  const skills = names.map((name): Skill => {
    const filePath = path.join(root, "skills", name, "SKILL.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} description\n---\n`);
    return {
      name,
      description: `${name} description`,
      filePath,
      baseDir: path.dirname(filePath),
      disableModelInvocation: false,
      sourceInfo: { path: filePath, source, scope: "user", origin: "package", baseDir: root },
    };
  });
  return { root, skills };
}

beforeEach(resetSuperpowersStateForTests);
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

it("is silent and inactive when stock Superpowers is absent", () => {
  expect(captureSuperpowersSkills([])).toEqual({ status: "inactive" });
  expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();
  expect(takeSuperpowersWarning()).toBeUndefined();
});

it("selects only worker and reviewer starting skills from one official root", () => {
  const { skills } = writeStockRoot();
  expect(captureSuperpowersSkills(skills).status).toBe("active");

  const worker = prepareSuperpowersLaunch("worker", "task-1")!;
  expect(worker.selectedSkills.map((skill) => skill.name)).toEqual([
    "test-driven-development",
    "verification-before-completion",
  ]);
  expect(worker.assignmentId).toBe("task-1");

  const reviewer = prepareSuperpowersLaunch("reviewer")!;
  expect(reviewer.selectedSkills.map((skill) => skill.name)).toEqual([
    "verification-before-completion",
  ]);
  expect(prepareSuperpowersLaunch("planner")).toBeUndefined();
});

it("renders focused guidance without hiding unrelated skills", () => {
  const { skills } = writeStockRoot();
  captureSuperpowersSkills(skills);
  const text = renderSuperpowersGuidance(prepareSuperpowersLaunch("worker", "task-1")!);
  expect(text).toContain("test-driven-development");
  expect(text).toContain("verification-before-completion");
  expect(text).toContain("Other relevant installed skills remain available");
  expect(text).toContain("checkout assigned by Crew");
  expect(text).toContain("Do not create, switch to, or manage nested worktrees");
  expect(text).not.toContain("writing-plans");
});
```

Add cases in the same file for:

```ts
it.each([
  ["7.0.0", "unsupported Superpowers major version"],
  ["invalid", "invalid Superpowers version"],
])("falls back for version %s", (version, reason) => {
  const { root, skills } = writeStockRoot();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "superpowers", version }));
  expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback", reason: expect.stringContaining(reason) });
});

it("falls back completely when a required skill is missing", () => {
  const { skills } = writeStockRoot();
  const withoutTdd = skills.filter((skill) => skill.name !== "test-driven-development");
  expect(captureSuperpowersSkills(withoutTdd)).toMatchObject({
    status: "fallback",
    reason: expect.stringContaining("test-driven-development"),
  });
  expect(prepareSuperpowersLaunch("reviewer")).toBeUndefined();
});

it("rejects a project skill shadowing an official required skill", () => {
  const { root, skills } = writeStockRoot();
  const officialTdd = skills.find((skill) => skill.name === "test-driven-development")!;
  const shadow: Skill = {
    ...officialTdd,
    filePath: path.join(root, "project-shadow", "SKILL.md"),
    sourceInfo: { path: "project-shadow", source: "auto", scope: "project", origin: "top-level", baseDir: root },
  };
  const catalog = skills.map((skill) => skill.name === shadow.name ? shadow : skill);
  expect(captureSuperpowersSkills(catalog)).toMatchObject({ status: "fallback", reason: expect.stringContaining("shadowed") });
});

it("accepts a local checkout only when its Git origin is official", () => {
  const { root, skills } = writeStockRoot();
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:obra/superpowers.git"], { cwd: root });
  const localSkills = skills.map((skill): Skill => ({
    ...skill,
    sourceInfo: { ...skill.sourceInfo, source: root },
  }));
  expect(captureSuperpowersSkills(localSkills).status).toBe("active");
});

it("rejects a local checkout whose Git origin is not official", () => {
  const { root, skills } = writeStockRoot();
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/superpowers.git"], { cwd: root });
  const localSkills = skills.map((skill): Skill => ({
    ...skill,
    sourceInfo: { ...skill.sourceInfo, source: root },
  }));
  expect(captureSuperpowersSkills(localSkills)).toMatchObject({
    status: "fallback",
    reason: expect.stringContaining("official obra/superpowers"),
  });
});
```

Add explicit cases for conflicting official roots and a missing bootstrap marker; both must expect `status: "fallback"` and a reason naming the conflict or marker.

Add warning deduplication assertions:

```ts
it("warns once per unchanged fallback fingerprint", () => {
  const { skills } = writeStockRoot();
  captureSuperpowersSkills(skills.filter((skill) => skill.name !== "test-driven-development"));
  prepareSuperpowersLaunch("worker", "task-1");
  expect(takeSuperpowersWarning()).toContain("test-driven-development");
  prepareSuperpowersLaunch("worker", "task-2");
  expect(takeSuperpowersWarning()).toBeUndefined();
});
```

- [ ] **Step 2: Run the adapter tests to verify RED**

Run:

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: FAIL because `crew/superpowers.ts` does not exist.

- [ ] **Step 3: Implement the smallest concrete adapter**

Use fixed constants and plain functions. Do not add a class, registry, configuration file, semver dependency, or provider abstraction.

Start with:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Skill } from "@earendil-works/pi-coding-agent";

const SUPPORTED_MAJOR = 6;
const REQUIRED_NAMES = ["test-driven-development", "verification-before-completion"] as const;
const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const SUPPORTED_ROLES = new Set(["worker", "reviewer"]);
const PROHIBITED_WORKFLOWS = [
  "Do not start nested agents or SDD controllers.",
  "Do not start plan executors or branch-finishing workflows.",
  "Do not create, switch to, or manage nested worktrees; use the checkout assigned by Crew.",
];

let currentState: SuperpowersState = { status: "inactive" };
let lastSelection: SuperpowersSelectionRecord | undefined;
let pendingWarning: string | undefined;
let warnedFingerprint: string | undefined;
```

Implement provenance with these exact rules:

1. Treat the catalog as `inactive` unless a loaded `using-superpowers` skill or package source/path contains an identifiable Superpowers candidate.
2. Require `sourceInfo.origin === "package"` for every required selected skill.
3. Derive one package root from `sourceInfo.baseDir`; canonicalize it with `fs.realpathSync`.
4. For official package sources, normalize `git:`, HTTPS, SSH, `git@github.com:`, optional `.git`, and optional pinned `@ref`, then compare with `obra/superpowers`.
5. For a local source, run only `git -C <root> remote get-url origin`; normalize and compare the returned URL with `obra/superpowers`.
6. Read `<root>/package.json`; require `{ name: "superpowers", version: "6.x.y" }` and major `6`.
7. Require `<root>/.pi/extensions/superpowers.ts` to contain the stock bootstrap marker.
8. For each required name, require the loaded canonical `filePath` to equal `<root>/skills/<name>/SKILL.md` and be readable.
9. Return the first bounded fallback reason; never throw outside `captureSuperpowersSkills`.

Use a simple normalizer:

```ts
function normalizeOfficialSource(value: string): string {
  return value.trim()
    .replace(/^git:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git(?=@|$)/, "")
    .replace(/@[^/]+$/, "");
}

function isOfficialSource(value: string): boolean {
  return normalizeOfficialSource(value) === "obra/superpowers";
}
```

Build role rows with fixed data, preserving order:

```ts
const ROLE_RULES = {
  worker: [
    ["test-driven-development", "Apply RED-GREEN-REFACTOR to behavior changes."],
    ["verification-before-completion", "Run fresh checks before completion claims."],
  ],
  reviewer: [
    ["verification-before-completion", "Verify evidence supporting the review verdict."],
  ],
} as const;
```

`prepareSuperpowersLaunch` returns `undefined` for unsupported roles, inactivity, or fallback. On fallback it queues one message formatted as:

```text
Superpowers integration fallback: <reason>. <correctiveAction> Crew continued with native guidance.
```

`renderSuperpowersGuidance` must render only the selected rows, the three fixed ownership restrictions, and the sentence that other skills remain available. Keep it below 1,500 characters in tests.

- [ ] **Step 4: Run adapter tests to verify GREEN**

Run:

```bash
npm exec vitest -- run tests/crew/superpowers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run focused type and diagnostic checks**

Run:

```bash
npm exec tsc -- --noEmit
```

Then run `lsp_diagnostics` on `crew/superpowers.ts` and `tests/crew/superpowers.test.ts`.

Expected: no TypeScript errors and no blocking diagnostics.

- [ ] **Step 6: Commit Task 1**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "feat: add concrete Superpowers adapter"
```

---

### Task 2: Active launch integration and child guard

**Files:**

- Create: `crew/superpowers-guard.ts`
- Modify: `crew/agents.ts`
- Modify: `index.ts`
- Create: `tests/crew/superpowers-launch.test.ts`
- Create: `tests/crew/superpowers-guard.test.ts`
- Create: `tests/crew/superpowers-extension.test.ts`

**Interfaces:**

- Consumes: Task 1's `captureSuperpowersSkills`, `prepareSuperpowersLaunch`, and `renderSuperpowersGuidance`.
- Produces:

```ts
export const SUPERPOWERS_CHILD_FLAG = "PI_CREW_SUPERPOWERS_MVP";
export const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
export const LEGACY_POLICY_MARKER = "<!-- crew-superpowers-policy:";
export function stripStockBootstrap(messages: unknown[]): unknown[];
export function stripLegacyPolicy(systemPrompt: string): string;
```

- [ ] **Step 1: Write failing guard tests**

Create `tests/crew/superpowers-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripLegacyPolicy, stripStockBootstrap } from "../../crew/superpowers-guard.js";

it("removes only the marked stock bootstrap message", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "keep before" }] },
    { role: "user", content: [{ type: "text", text: "superpowers:using-superpowers bootstrap for pi\nremove" }] },
    { role: "toolResult", content: [{ type: "text", text: "keep after" }] },
  ];
  expect(stripStockBootstrap(messages)).toEqual([messages[0], messages[2]]);
});

it("removes only a marked legacy policy suffix", () => {
  const prompt = "base\n\n<!-- crew-superpowers-policy:bootstrap-v2 -->\nlegacy policy";
  expect(stripLegacyPolicy(prompt)).toBe("base");
  expect(stripLegacyPolicy("base\n\nunrelated append")).toBe("base\n\nunrelated append");
});
```

Also register the default extension against a mock `ExtensionAPI` and assert its handlers do nothing unless both `PI_CREW_SUPERPOWERS_MVP=1` and `PI_CREW_ROLE` is `worker` or `reviewer`.

- [ ] **Step 2: Write failing launch tests**

Create `tests/crew/superpowers-launch.test.ts` by following the process mock in `tests/crew/model-override.test.ts`. Capture spawn arguments, environment, and the append-prompt file synchronously inside `spawnMock` before the close handler removes it.

Required assertions:

```ts
expect(args).toContain("--append-system-prompt");
expect(capturedPrompt).toContain("You are the project worker override.");
expect(capturedPrompt).toContain("test-driven-development");
expect(capturedPrompt).toContain("verification-before-completion");
expect(capturedPrompt.indexOf("project worker override")).toBeLessThan(capturedPrompt.indexOf("Superpowers guidance for Crew"));
expect(args.slice(args.indexOf("--extension"))).toContain(expect.stringContaining("superpowers-guard.ts"));
expect(spawnOptions.env).toMatchObject({
  PI_CREW_ROLE: "worker",
  PI_CREW_SUPERPOWERS_MVP: "1",
});
```

Add reviewer assertions for verification only. Add inactive and fallback assertions comparing the full args, environment, and append prompt with a baseline run after `resetSuperpowersStateForTests()`; there must be no guard path, role flag, MVP flag, or appended guidance.

- [ ] **Step 3: Write the failing lifecycle capture test**

Create `tests/crew/superpowers-extension.test.ts` with the lightweight mock-ExtensionAPI pattern from `tests/status-heartbeat.test.ts`. Use one untrusted loaded `using-superpowers` candidate: if the registered handler forwards Pi's catalog, the real adapter will move from inactive to fallback.

```ts
const loadedSkills = [{
  name: "using-superpowers",
  description: "candidate",
  filePath: path.join(cwd, "untrusted", "SKILL.md"),
  baseDir: path.join(cwd, "untrusted"),
  disableModelInvocation: false,
  sourceInfo: {
    path: path.join(cwd, "untrusted", "SKILL.md"),
    source: "auto",
    scope: "project",
    origin: "top-level",
    baseDir: cwd,
  },
}] as any;
const beforeStart = pi.handlers.get("before_agent_start")?.[0];
await beforeStart?.({
  systemPrompt: "base",
  systemPromptOptions: { cwd, skills: loadedSkills },
}, ctx);
expect(getSuperpowersState()).toMatchObject({
  status: "fallback",
  reason: expect.stringContaining("official"),
});
```

- [ ] **Step 4: Run Task 2 tests to verify RED**

Run:

```bash
npm exec vitest -- run \
  tests/crew/superpowers-guard.test.ts \
  tests/crew/superpowers-launch.test.ts \
  tests/crew/superpowers-extension.test.ts
```

Expected: FAIL because the guard and launch integration do not exist.

- [ ] **Step 5: Implement the child guard**

Create `crew/superpowers-guard.ts` as one small extension. Do not import Crew state, store, or configuration:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUPERPOWERS_CHILD_FLAG = "PI_CREW_SUPERPOWERS_MVP";
export const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
export const LEGACY_POLICY_MARKER = "<!-- crew-superpowers-policy:";
const SUPPORTED_ROLES = new Set(["worker", "reviewer"]);

function containsMarker(message: unknown): boolean {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content.includes(STOCK_BOOTSTRAP_MARKER);
  if (!Array.isArray(content)) return false;
  return content.some((part) =>
    part && typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string" &&
    (part as { text: string }).text.includes(STOCK_BOOTSTRAP_MARKER));
}

export function stripStockBootstrap(messages: unknown[]): unknown[] {
  return messages.filter((message) => !containsMarker(message));
}

export function stripLegacyPolicy(systemPrompt: string): string {
  const index = systemPrompt.indexOf(LEGACY_POLICY_MARKER);
  return index === -1 ? systemPrompt : systemPrompt.slice(0, index).trimEnd();
}

export default function superpowersGuard(pi: ExtensionAPI): void {
  if (process.env[SUPERPOWERS_CHILD_FLAG] !== "1") return;
  if (!SUPPORTED_ROLES.has(process.env.PI_CREW_ROLE ?? "")) return;

  pi.on("before_agent_start", (event) => ({
    systemPrompt: stripLegacyPolicy(event.systemPrompt),
  }));
  pi.on("context", (event) => ({
    messages: stripStockBootstrap(event.messages) as typeof event.messages,
  }));
}
```

- [ ] **Step 6: Capture the authoritative catalog in the root extension**

In `index.ts`, import `captureSuperpowersSkills` and register one handler near the other lifecycle handlers:

```ts
pi.on("before_agent_start", (event) => {
  captureSuperpowersSkills(event.systemPromptOptions.skills ?? []);
});
```

Do not scan settings, package directories, or the filesystem from `index.ts`; Task 1 owns package validation.

- [ ] **Step 7: Apply active guidance at the existing launch boundary**

In `crew/agents.ts`:

- Add `SUPERPOWERS_GUARD_PATH = path.resolve(__dirname, "superpowers-guard.ts")`.
- Resolve the existing `role` first.
- Call `prepareSuperpowersLaunch(role, task.taskId)` once.
- Build `effectiveSystemPrompt` from the unmodified `agentConfig?.systemPrompt` plus rendered guidance only when a selection exists.
- Add the normal `EXTENSION_DIR` first and the guard path second.
- Add `PI_CREW_ROLE` and `PI_CREW_SUPERPOWERS_MVP` only when active.
- Keep the existing `PI_CREW_WORKER` and `PI_AGENT_NAME` behavior unchanged.

Use this shape:

```ts
const selection = prepareSuperpowersLaunch(role, task.taskId);
const effectiveSystemPrompt = selection
  ? [agentConfig?.systemPrompt, renderSuperpowersGuidance(selection)].filter(Boolean).join("\n\n")
  : agentConfig?.systemPrompt;

args.push("--extension", EXTENSION_DIR);
if (selection) args.push("--extension", SUPERPOWERS_GUARD_PATH);

if (effectiveSystemPrompt) {
  // Existing secure temporary-file behavior, using effectiveSystemPrompt.
}

const integrationEnv = selection
  ? { PI_CREW_ROLE: role, PI_CREW_SUPERPOWERS_MVP: "1" }
  : {};
const env = Object.keys(envOverrides).length > 0 || role === "worker" || selection
  ? { ...process.env, ...envOverrides, ...workerFlag, ...integrationEnv }
  : undefined;
```

Do not add fields to task/plan schemas or persist the selection.

- [ ] **Step 8: Run Task 2 tests to verify GREEN**

Run:

```bash
npm exec vitest -- run \
  tests/crew/superpowers.test.ts \
  tests/crew/superpowers-guard.test.ts \
  tests/crew/superpowers-launch.test.ts \
  tests/crew/superpowers-extension.test.ts \
  tests/crew/model-override.test.ts \
  tests/crew/graceful-shutdown.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run focused type and diagnostic checks**

Run:

```bash
npm exec tsc -- --noEmit
```

Then run `lsp_diagnostics` on `crew/superpowers-guard.ts`, `crew/agents.ts`, `index.ts`, and the three new test files.

Expected: no TypeScript errors and no blocking diagnostics.

- [ ] **Step 10: Commit Task 2**

```bash
git add \
  crew/superpowers-guard.ts crew/agents.ts index.ts \
  tests/crew/superpowers-guard.test.ts \
  tests/crew/superpowers-launch.test.ts \
  tests/crew/superpowers-extension.test.ts
git commit -m "feat: guide Crew workers with stock Superpowers"
```

---

### Task 3: Minimal status and actionable fallback warning

**Files:**

- Modify: `index.ts`
- Modify: `crew/handlers/status.ts`
- Modify: `README.md`
- Modify: `tests/crew/superpowers-extension.test.ts`
- Modify: `tests/crew/status.test.ts`
- Modify: `tests/crew/superpowers.test.ts`

**Interfaces:**

- Consumes: Task 1's `renderSuperpowersStatus`, `getSuperpowersStatusDetails`, and `takeSuperpowersWarning`.
- Produces: existing `pi_messenger` tool result with an optional warning prefix; existing `crew status` output/details with one new `superpowers` field.

- [ ] **Step 1: Write failing status tests**

In `tests/crew/status.test.ts`, reset adapter state in `beforeEach`. Add this local fixture helper so active status uses real adapter validation rather than a production test hook:

```ts
function activateStatusSuperpowers(cwd: string): void {
  const root = path.join(cwd, "stock-superpowers");
  fs.mkdirSync(path.join(root, ".pi", "extensions"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "superpowers", version: "6.2.0" }));
  fs.writeFileSync(
    path.join(root, ".pi", "extensions", "superpowers.ts"),
    'const marker = "superpowers:using-superpowers bootstrap for pi";\n',
  );
  const skills = ["using-superpowers", "test-driven-development", "verification-before-completion"].map((name) => {
    const filePath = path.join(root, "skills", name, "SKILL.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\n`);
    return {
      name,
      description: name,
      filePath,
      baseDir: path.dirname(filePath),
      disableModelInvocation: false,
      sourceInfo: {
        path: filePath,
        source: "git:github.com/obra/superpowers",
        scope: "user" as const,
        origin: "package" as const,
        baseDir: root,
      },
    };
  });
  captureSuperpowersSkills(skills);
}

it("shows silent inactive integration status without a plan", async () => {
  const { cwd } = createTempCrewDirs();
  const response = await execute({ cwd } as any);
  expect(response.content[0].text).toContain("Superpowers integration: inactive (not installed)");
  expect(response.content[0].text).not.toContain("⚠");
  expect(response.details.superpowers).toMatchObject({ status: "inactive" });
});

it("shows active role mappings and latest launch", async () => {
  const { cwd } = createTempCrewDirs();
  createPlan(cwd, "README.md");
  activateStatusSuperpowers(cwd);
  prepareSuperpowersLaunch("worker", "task-1");
  const response = await execute({ cwd } as any);
  expect(response.content[0].text).toContain("Superpowers integration: active (6.2.0)");
  expect(response.content[0].text).toContain("Worker: test-driven-development, verification-before-completion");
  expect(response.content[0].text).toContain("Reviewer: verification-before-completion");
  expect(response.content[0].text).toContain("Last launch: worker task-1");
});
```

Add fallback status coverage with its reason and corrective action.

- [ ] **Step 2: Write the failing non-interactive warning test**

In `tests/crew/superpowers-extension.test.ts`:

1. Capture an incomplete catalog.
2. Call `prepareSuperpowersLaunch("worker", "task-1")` to represent an actual fallback launch attempt.
3. Invoke the registered `pi_messenger` tool with a harmless unknown action and a context whose `hasUI` is `false`.
4. Assert the returned first text block starts with `⚠ Superpowers integration fallback:`.
5. Invoke again without changing the catalog and assert the warning is absent.

Also assert `ctx.ui.notify` receives the same warning when `hasUI` is true; the result prefix remains present so UI is not the sole signal.

- [ ] **Step 3: Run Task 3 tests to verify RED**

Run:

```bash
npm exec vitest -- run \
  tests/crew/superpowers.test.ts \
  tests/crew/superpowers-extension.test.ts \
  tests/crew/status.test.ts
```

Expected: FAIL because status and tool result paths do not expose adapter state.

- [ ] **Step 4: Add compact status output**

In `crew/handlers/status.ts`, compute once:

```ts
const superpowersText = renderSuperpowersStatus();
const superpowersDetails = getSuperpowersStatusDetails();
```

Insert `\n\n## Superpowers\n${superpowersText}` in both the no-plan result and the normal plan result. Add `superpowers: superpowersDetails` to both details objects. Do not add a command, footer widget, durable file, or configuration option.

- [ ] **Step 5: Attach pending fallback warnings to the existing tool result**

In `index.ts`, immediately after `executeCrewAction(...)` returns:

```ts
const superpowersWarning = takeSuperpowersWarning();
if (superpowersWarning) {
  if (ctx.hasUI) ctx.ui.notify(superpowersWarning, "warning");
  const first = result.content[0];
  if (first?.type === "text") {
    first.text = `⚠ ${superpowersWarning}\n\n${first.text}`;
  }
}
```

Keep this local mutation; do not create middleware, a warning bus, or a generic result-decorator abstraction. The pending warning is queued only by `prepareSuperpowersLaunch`, so status and unrelated actions do not create warnings by themselves.

- [ ] **Step 6: Run Task 3 tests to verify GREEN**

Run:

```bash
npm exec vitest -- run \
  tests/crew/superpowers.test.ts \
  tests/crew/superpowers-extension.test.ts \
  tests/crew/status.test.ts
```

Expected: PASS.

- [ ] **Step 7: Document the shipped ownership boundary**

Add a short `Superpowers integration` section to `README.md` with this exact substance:

```markdown
## Superpowers integration

When the separately installed official Superpowers package is available, Crew workers start with test-driven development and verification guidance, and Crew reviewers start with verification guidance. Crew remains the sole owner of planning, dispatch, task state, review dispatch, and repository coordination.

Other Pi-loaded project and user skills remain available. Dispatched Crew agents must not start nested orchestration or create or switch to nested worktrees; they continue in the checkout assigned by Crew.

Run `pi_messenger({ action: "status" })` to inspect active, inactive, or native-fallback integration status. Missing Superpowers is silent. An incomplete or incompatible installation produces one warning and Crew continues with native guidance.
```

Also state that the old global `crew-superpowers-policy.ts` extension may be removed after installing this packaged adapter; active Crew children ignore its exact marked legacy policy if it remains during migration.

- [ ] **Step 8: Run the full deterministic suite and type check**

Run:

```bash
npm test
npm exec tsc -- --noEmit
```

Expected: all tests pass and TypeScript exits 0.

Run `lens_diagnostics mode=all` for all Task 1–3 production and test files. Fix blocking findings; do not expand into unrelated cleanup.

- [ ] **Step 9: Commit Task 3**

```bash
git add \
  index.ts crew/handlers/status.ts README.md \
  tests/crew/superpowers.test.ts \
  tests/crew/superpowers-extension.test.ts \
  tests/crew/status.test.ts
git commit -m "feat: expose Superpowers integration status"
```

---

### Task 4: Small supervised live-acceptance fixture

**Files:**

- Create: `evals/definitions/integration-mvp.md`
- Create: `evals/fixtures/integration-mvp/seed/PRD.md`
- Create: `evals/fixtures/integration-mvp/seed/package.json`
- Create: `evals/fixtures/integration-mvp/seed/src/clamp.mjs`
- Create: `evals/fixtures/integration-mvp/seed/test/clamp.test.mjs`
- Create: `evals/fixtures/integration-mvp/seed/.pi/skills/project-style/SKILL.md`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/config.json`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/plan.json`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.json`
- Create: `evals/fixtures/integration-mvp/seed/.pi/messenger/crew/tasks/task-1.md`
- Create: `evals/scripts/reset-integration-mvp.mjs`
- Create: `evals/scripts/verify-integration-mvp.mjs`
- Create: `evals/results/integration-mvp-TEMPLATE.md`
- Create: `tests/evals/integration-mvp.test.ts`
- Modify: `evals/README.md`

**Interfaces:**

- Consumes: existing `evals/scripts/lib.mjs` path-safety and command helpers; existing Crew JSON schemas; existing artifact JSONL output.
- Produces:

```js
export function resetIntegrationMvp({ repositoryRoot, destination, now }): {
  worktree: string;
  seedCommit: string;
  manifestPath: string;
};

export function verifyIntegrationMvp({ repositoryRoot, worktree }): {
  status: "passed";
  workerTrace: string;
  reviewerTrace: string;
};
```

- [ ] **Step 1: Write the fixed acceptance definition**

`evals/definitions/integration-mvp.md` must state one preplanned task: implement and export `clamp(value, min, max)` using tests first, follow the project `project-style` skill, commit, complete through `pi_messenger`, and undergo existing automatic review. Acceptance requires:

- `npm test` passes;
- task `task-1` is `done`;
- worker trace reads stock TDD, stock verification, and project-style skills;
- worker trace calls `pi_messenger`;
- reviewer trace reads stock verification;
- no trace calls a subagent/agent-dispatch tool, launches nested Pi, or runs `git worktree add`/`git worktree switch`;
- `git worktree list --porcelain` reports one checkout; and
- a separate run with Superpowers disabled remains native and warning-free.

- [ ] **Step 2: Create the tiny failing code fixture**

Use this seed package:

```json
{
  "name": "integration-mvp-fixture",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

Seed `src/clamp.mjs` with:

```js
export function clamp() {
  throw new Error("not implemented");
}
```

Seed `test/clamp.test.mjs` with cases for below range, inside range, above range, and `min > max` throwing `RangeError`.

- [ ] **Step 3: Preseed the project skill and Crew state**

Seed `.pi/skills/project-style/SKILL.md` with valid frontmatter and one distinctive rule: `clamp` must remain a named export and must not be a default export. This is original fixture content, not copied Superpowers content.

Preseed one plan and task so live acceptance does not exercise deferred planner integration:

```json
{
  "prd": "PRD.md",
  "created_at": "2026-07-29T00:00:00.000Z",
  "updated_at": "2026-07-29T00:00:00.000Z",
  "task_count": 1,
  "completed_count": 0
}
```

```json
{
  "id": "task-1",
  "title": "Implement clamp with test-first evidence",
  "status": "todo",
  "depends_on": [],
  "skills": ["project-style"],
  "created_at": "2026-07-29T00:00:00.000Z",
  "updated_at": "2026-07-29T00:00:00.000Z",
  "attempt_count": 0
}
```

Enable existing review and existing bounded artifacts only in fixture config:

```json
{
  "review": { "enabled": true, "maxIterations": 1 },
  "artifacts": { "enabled": true, "cleanupDays": 1 },
  "concurrency": { "workers": 1, "max": 1 }
}
```

- [ ] **Step 4: Write failing reset and verifier tests**

Create `tests/evals/integration-mvp.test.ts` using `tests/evals/helpers.ts` patterns. Cover:

- reset creates a marked Git repository only under `evals/runs/integration-mvp`;
- reset refuses an unmarked existing destination;
- reset never invokes Pi or a model;
- verifier fails before implementation;
- verifier passes against a synthetic completed task plus synthetic worker/reviewer JSONL traces containing required reads and `pi_messenger`;
- verifier rejects a `subagent` tool call, nested `pi -p`, `git worktree add`, missing project skill read, missing reviewer verification read, or a second worktree.

Use JSONL events in the same shape consumed by `crew/utils/progress.ts`:

```json
{"type":"tool_execution_start","toolName":"read","args":{"path":"/official/superpowers/skills/test-driven-development/SKILL.md"}}
{"type":"tool_execution_start","toolName":"pi_messenger","args":{"action":"task.done"}}
```

- [ ] **Step 5: Run eval tests to verify RED**

Run:

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts
```

Expected: FAIL because reset/verifier scripts and fixture do not exist.

- [ ] **Step 6: Implement the reset script without a framework**

Copy only the small safety pattern from `reset-independent-parallel.mjs`:

- fixed fixture name `integration-mvp`;
- destination must be a descendant of `evals/runs/integration-mvp`;
- replacement requires `.git/pi-super-messenger-eval-marker.json` with matching fixture;
- copy seed, initialize Git, commit seed, and write marker/manifest under `.git`;
- exported function accepts injected `now` for tests;
- CLI accepts zero or one destination argument;
- no package installation, Pi launch, network call, auth copy, or generalized fixture registry.

- [ ] **Step 7: Implement the verifier with direct checks**

`verify-integration-mvp.mjs` must:

1. Validate the marked run and immutable fixture test hashes.
2. Run `npm test` in the fixture.
3. Read `task-1.json` and require `status === "done"`.
4. Find exactly one `*_crew-worker_*.jsonl` and one `*_crew-reviewer_*.jsonl` under `.pi/messenger/crew/artifacts`.
5. Parse only non-empty JSONL lines.
6. Require worker `read` paths ending in:
   - `/skills/test-driven-development/SKILL.md`;
   - `/skills/verification-before-completion/SKILL.md`; and
   - `/.pi/skills/project-style/SKILL.md`.
7. Require reviewer `read` path ending in `/skills/verification-before-completion/SKILL.md`.
8. Require worker `pi_messenger` calls.
9. Reject tool names matching `subagent`, `dispatch`, or `task` when they are not `pi_messenger`.
10. Reject Bash commands matching `git\s+worktree\s+(add|move|remove)` or a nested `pi` launch.
11. Require one line beginning with `worktree` from `git worktree list --porcelain`.
12. Return a small result object and print it as JSON from CLI.

Do not build a generic trace-query language or eval runner.

- [ ] **Step 8: Run eval tests to verify GREEN**

Run:

```bash
npm exec vitest -- run tests/evals/integration-mvp.test.ts tests/evals/definitions.test.ts
```

Expected: PASS.

- [ ] **Step 9: Document the exact supervised live procedure**

Append a separate `Integration MVP acceptance` section to `evals/README.md`:

```bash
node evals/scripts/reset-integration-mvp.mjs
cd evals/runs/integration-mvp/worktree
pi -e /absolute/path/to/super-pi-messenger
# In Pi: ask it to run pi_messenger({ action: "work" }) and wait for worker plus automatic reviewer.
cd /absolute/path/to/super-pi-messenger
node evals/scripts/verify-integration-mvp.mjs evals/runs/integration-mvp/worktree
```

Document two human checkpoints:

1. Before launch, `crew status` must show active Superpowers with worker/reviewer mappings.
2. Repeat from a fresh reset with Superpowers disabled in an isolated Pi agent directory; `crew status` must show inactive, no warning may appear, and native Crew must still complete.

State explicitly that the scripts never launch a model, raw traces remain ignored under `evals/runs`, and only a reviewed sanitized result is copied into `evals/results/integration-mvp-TEMPLATE.md`.

The result template records commit, package version/root, active/inactive status, selected paths, task/test outcome, forbidden-call outcome, project-skill outcome, reviewer outcome, interventions, model usage when available, and sanitized evidence locations.

- [ ] **Step 10: Run all deterministic verification**

Run:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

Expected: all tests pass, type check exits 0, and no whitespace errors.

Run `lens_diagnostics mode=all` for every changed production, test, eval script, and Markdown file. Fix only findings caused by this work.

- [ ] **Step 11: Commit Task 4**

```bash
git add \
  evals/definitions/integration-mvp.md \
  evals/fixtures/integration-mvp \
  evals/scripts/reset-integration-mvp.mjs \
  evals/scripts/verify-integration-mvp.mjs \
  evals/results/integration-mvp-TEMPLATE.md \
  evals/README.md \
  tests/evals/integration-mvp.test.ts
git commit -m "test: add Superpowers integration acceptance fixture"
```

---

## Final supervised acceptance and release gate

The following is a human-supervised gate, not an additional implementation task or an automated model test.

- [ ] Create a fresh ignored fixture with `node evals/scripts/reset-integration-mvp.mjs`.
- [ ] Confirm stock Superpowers 6 is enabled and the legacy global policy extension may remain installed for coexistence testing.
- [ ] Launch the local package with the exact documented `pi -e` command.
- [ ] Run `crew status`; record active version, selected worker/reviewer skills, and no duplicate legacy policy.
- [ ] Run the preplanned task through `pi_messenger({ action: "work" })`.
- [ ] Stop immediately if the worker lacks `pi_messenger`; add only a focused failing launcher-contract test and the smallest fix before repeating acceptance.
- [ ] Run `node evals/scripts/verify-integration-mvp.mjs <worktree>` and require PASS.
- [ ] Inspect raw JSONL before cleanup for methodology reads, unrelated project skill access, reviewer behavior, and absence of nested orchestration/worktrees.
- [ ] Repeat from a fresh reset with Superpowers disabled in an isolated agent directory; require inactive status, no warning, native completion, and unchanged project override behavior.
- [ ] Record a sanitized result from `evals/results/integration-mvp-TEMPLATE.md`; do not commit raw traces or credentials.
- [ ] Run final repository verification:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check
```

- [ ] Run `lens_diagnostics mode=all` on all files changed by the implementation.
- [ ] Request independent code review against this plan and `docs/superpowers/specs/2026-07-29-superpowers-integration-mvp-design.md`.
- [ ] Do not call the MVP complete until deterministic checks, live active acceptance, live inactive fallback acceptance, and independent review all pass.

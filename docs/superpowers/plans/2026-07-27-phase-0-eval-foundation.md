# Phase 0 Eval Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define all three initial evals, build and deterministically verify the independent-parallel fixture, isolate stock `pi-messenger@0.14.1`, record one supervised stock baseline, and document selective upstream maintenance.

**Architecture:** Keep model execution supervised while making fixture reset, functional verification, runtime isolation, and cleanup deterministic. Store immutable seeds and concise results in Git, store active worktrees and operator-created sanitized excerpts under ignored `evals/runs/`, and keep copied authentication only in a marked operating-system temporary directory. Test all tooling through exported functions and fake executables; normal tests and CI never launch models.

**Tech Stack:** Node.js ESM, built-in `node:test`, TypeScript, Vitest, Git, Pi CLI, npm.

## Global Constraints

- Implement from an isolated feature worktree created from local `main` at or after commit `56a81ed`.
- Do not use Crew for implementation unless the user explicitly requests Crew.
- Do not modify stock Superpowers or copy any Superpowers prompt, skill, or source content.
- Do not add a benchmark framework, database, dashboard, automatic model launcher, product telemetry, token budget, credit budget, or model-driven CI job.
- Only `evals/fixtures/independent-parallel/` is implemented in Phase 0; shared-interface and review-repair receive definitions only.
- Keep actual model execution supervised and require an explicit human checkpoint before the first model call.
- Never place `auth.json`, provider secrets, or copied authentication beneath the repository.
- Default destructive paths must be under the designated eval run root or operating-system temporary runtime root; reject symlink escapes and missing markers.
- Pin the stock package to `npm:pi-messenger@0.14.1` and never substitute a model silently.
- Disable stock artifacts for this baseline to avoid known raw snapshot amplification.
- Raw runtime evidence is inspectable only before cleanup. Cleanup never retains or copies raw runtime evidence. Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`.
- Use dependency-free fixture code and built-in Node test tooling.
- Use explicit Git paths in every commit.
- Stop after Task 7 Step 2 and ask the user to run the printed supervised command; do not launch Pi or spend model credits automatically.

---

### Task 1: Fix eval definitions, result schema, and upstream policy

**Files:**
- Create: `tests/evals/definitions.test.ts`
- Create: `evals/README.md`
- Create: `evals/definitions/independent-parallel.md`
- Create: `evals/definitions/shared-interface.md`
- Create: `evals/definitions/review-repair.md`
- Create: `evals/profiles/stock-baseline.json`
- Create: `evals/results/TEMPLATE.md`
- Create: `evals/results/stock-pi-messenger-0.14.1-independent-parallel.md`
- Create: `evals/runs/.gitignore`
- Create: `docs/upstream-maintenance.md`
- Reference: `docs/superpowers/specs/2026-07-27-phase-0-eval-foundation-design.md`

**Interfaces:**
- Consumes: Approved Phase 0 design and PRD Section 14/Phase 0.
- Produces: Fixed definition documents, `stock-baseline.json` profile consumed by reset/runtime scripts, and result fields consumed after the supervised run.

- [ ] **Step 1: Write the failing documentation-contract test**

Create `tests/evals/definitions.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Phase 0 eval definitions", () => {
  it("fixes all three evals before related fixtures are built", () => {
    const independent = read("evals/definitions/independent-parallel.md");
    const shared = read("evals/definitions/shared-interface.md");
    const repair = read("evals/definitions/review-repair.md");

    expect(independent).toContain("parseDuration(input)");
    expect(independent).toContain("formatBytes(bytes)");
    expect(independent).toContain("parseRetryAfter(value, nowMs)");
    expect(independent).toContain("Worker concurrency: `3`");
    expect(shared).toContain("CSV codec");
    expect(shared).toContain("JSON-lines codec");
    expect(shared).toContain("separate integration review");
    expect(repair).toContain("mergeSettings(defaults, overrides)");
    expect(repair).toContain("NEEDS_WORK");
    expect(repair).toContain("one scoped repair");
  });

  it("pins a non-secret stock comparison profile", () => {
    const profile = JSON.parse(read("evals/profiles/stock-baseline.json"));
    expect(profile.package).toBe("npm:pi-messenger@0.14.1");
    expect(profile.models).toEqual({
      planner: "openai-codex/gpt-5.6-sol",
      worker: "openai-codex/gpt-5.6-terra",
      reviewer: "openai-codex/gpt-5.6-sol",
      analyst: "openai-codex/gpt-5.6-luna",
    });
    expect(profile.concurrency).toEqual({ workers: 3, max: 3 });
    expect(profile.artifacts).toEqual({ enabled: false });
    expect(JSON.stringify(profile)).not.toMatch(/token|secret|api.?key/i);
  });

  it("defines durable results without committing raw runs", () => {
    const template = read("evals/results/TEMPLATE.md");
    const ignore = read("evals/runs/.gitignore");
    for (const heading of [
      "Run identity", "Functional outcome", "Orchestration observations",
      "Review outcome", "Reliability", "Usage metadata", "Evidence", "Comparability",
    ]) expect(template).toContain(`## ${heading}`);
    expect(ignore).toBe("*\n!.gitignore\n");
  });

  it("documents fetch-only selective upstream intake", () => {
    const upstream = read("docs/upstream-maintenance.md");
    expect(upstream).toContain("git fetch upstream --prune");
    expect(upstream).toContain("upstream push URL must remain `DISABLED`");
    expect(upstream).toContain("never merge automatically");
    expect(upstream).toContain("preserve authorship and attribution");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run tests/evals/definitions.test.ts
```

Expected: FAIL with `ENOENT` for the first missing definition.

- [ ] **Step 3: Write all three fixed definition documents**

Create the three definition files with these required sections:

```markdown
# Exact eval title

## Purpose
## Fixed task
## Fixture boundary
## Procedure
## Deterministic acceptance
## Supervised observations
## Product target versus stock baseline
```

Populate them with the exact contracts and lifecycle from Sections 4–6 of the approved design. The independent definition must explicitly name the three owned source paths, immutable test boundary, concurrency three, artifacts disabled, same-wave/overlap observations, task review, reservation conflicts, retries, interventions, provider metadata, and prohibited nested orchestration.

The shared-interface definition must fix the canonical record contract, parallel CSV and JSON-lines codec tasks, cross-codec round trips, exact task review scope, and separate integration review while stating that its fixture is deferred to Phase 2.

The repair definition must fix the caller-mutation defect, completed seed commit, expected `NEEDS_WORK`, one scoped repair, regression coverage, repair-owned re-review, design sanity check, and escalation conditions while stating that its fixture is deferred to Phase 3.

- [ ] **Step 4: Write the checked stock profile**

Create `evals/profiles/stock-baseline.json`:

```json
{
  "package": "npm:pi-messenger@0.14.1",
  "models": {
    "planner": "openai-codex/gpt-5.6-sol",
    "worker": "openai-codex/gpt-5.6-terra",
    "reviewer": "openai-codex/gpt-5.6-sol",
    "analyst": "openai-codex/gpt-5.6-luna"
  },
  "concurrency": { "workers": 3, "max": 3 },
  "planning": { "maxPasses": 1 },
  "review": { "enabled": true, "maxIterations": 1 },
  "work": { "maxAttemptsPerTask": 2 },
  "coordination": "chatty",
  "artifacts": { "enabled": false }
}
```

- [ ] **Step 5: Write operator, result, ignore, and upstream documentation**

Create `evals/README.md` with the ten-step supervised procedure, explicit reset/prepare/launch/verify/cleanup command shapes, a warning that preparation does not launch a model, and a warning that the printed Pi command begins provider usage.

Create `evals/results/TEMPLATE.md` with the eight headings asserted by the test and checkbox/table fields for every item in Design Section 10. Copy it initially to `evals/results/stock-pi-messenger-0.14.1-independent-parallel.md`, set `Status: NOT RUN`, and state that it becomes a baseline only after Task 8.

Create `evals/runs/.gitignore` exactly as tested.

Create `docs/upstream-maintenance.md` with the eight-step intake procedure from Design Section 12, including the exact fetch command, disabled upstream push invariant, dedicated branches, smallest coherent commit range, PRD/compatibility review, inherited tests, relevant evals, attribution, and no automatic merge.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/evals/definitions.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit the fixed definitions and policy**

```bash
git add -- \
  tests/evals/definitions.test.ts \
  evals/README.md \
  evals/definitions/independent-parallel.md \
  evals/definitions/shared-interface.md \
  evals/definitions/review-repair.md \
  evals/profiles/stock-baseline.json \
  evals/results/TEMPLATE.md \
  evals/results/stock-pi-messenger-0.14.1-independent-parallel.md \
  evals/runs/.gitignore \
  docs/upstream-maintenance.md
git diff --cached --check
git commit -m "docs: define Phase 0 evals and upstream policy"
```

---

### Task 2: Build the immutable independent-parallel seed

**Files:**
- Create: `tests/evals/fixture-seed.test.ts`
- Create: `evals/fixtures/independent-parallel/seed/PRD.md`
- Create: `evals/fixtures/independent-parallel/seed/package.json`
- Create: `evals/fixtures/independent-parallel/seed/src/duration.mjs`
- Create: `evals/fixtures/independent-parallel/seed/src/format-bytes.mjs`
- Create: `evals/fixtures/independent-parallel/seed/src/retry-after.mjs`
- Create: `evals/fixtures/independent-parallel/seed/test/duration.test.mjs`
- Create: `evals/fixtures/independent-parallel/seed/test/format-bytes.test.mjs`
- Create: `evals/fixtures/independent-parallel/seed/test/retry-after.test.mjs`

**Interfaces:**
- Consumes: `evals/definitions/independent-parallel.md` contracts.
- Produces: Intentionally red seed copied by `resetIndependentParallel()` and made green only inside ignored run worktrees.

- [ ] **Step 1: Write a failing repository-level seed test**

Create `tests/evals/fixture-seed.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const seed = resolve(root, "evals/fixtures/independent-parallel/seed");

describe("independent-parallel seed", () => {
  it("contains three disjoint task-owned stubs", () => {
    const prd = readFileSync(resolve(seed, "PRD.md"), "utf8");
    for (const path of ["src/duration.mjs", "src/format-bytes.mjs", "src/retry-after.mjs"]) {
      expect(prd).toContain(path);
      expect(readFileSync(resolve(seed, path), "utf8")).toContain("NOT_IMPLEMENTED");
    }
  });

  it("is intentionally red before workers implement it", () => {
    const result = spawnSync("node", ["--test", ...[
      "test/duration.test.mjs", "test/format-bytes.test.mjs", "test/retry-after.test.mjs",
    ]], { cwd: seed, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("NOT_IMPLEMENTED");
  });
});
```

- [ ] **Step 2: Run the seed test and verify RED**

```bash
npx vitest run tests/evals/fixture-seed.test.ts
```

Expected: FAIL with missing `PRD.md` or source files.

- [ ] **Step 3: Create the seed manifest, PRD, and stubs**

Create `package.json`:

```json
{
  "name": "super-pi-messenger-independent-parallel-eval",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/*.test.mjs" }
}
```

Create `PRD.md` with exactly three no-dependency tasks, each naming one owned source file and its corresponding immutable test file. Require implementation code only, no test edits, no new dependencies, and `npm test` acceptance.

Each source stub must export the named function and contain this sentinel in its body:

```javascript
throw new Error("NOT_IMPLEMENTED");
```

- [ ] **Step 4: Add immutable acceptance tests for all contracts**

Use built-in `node:test` and `node:assert/strict`. Cover at minimum:

```javascript
// duration.test.mjs
assert.equal(parseDuration("250ms"), 250);
assert.equal(parseDuration(" 5 m "), 300_000);
assert.equal(parseDuration("1.5h"), 5_400_000);
for (const value of ["", "-1s", "1h 2m", "7d", 5])
  assert.throws(() => parseDuration(value), TypeError);

// format-bytes.test.mjs
assert.equal(formatBytes(0), "0 B");
assert.equal(formatBytes(1024), "1 KiB");
assert.equal(formatBytes(1536), "1.5 KiB");
assert.equal(formatBytes(1024 ** 3), "1 GiB");
for (const value of [-1, 1.5, Infinity, "1024"])
  assert.throws(() => formatBytes(value), TypeError);

// retry-after.test.mjs
const now = Date.parse("2026-07-27T12:00:00Z");
assert.equal(parseRetryAfter("120", now), 120_000);
assert.equal(parseRetryAfter("Mon, 27 Jul 2026 12:01:30 GMT", now), 90_000);
assert.equal(parseRetryAfter("Mon, 27 Jul 2026 11:00:00 GMT", now), 0);
assert.equal(parseRetryAfter("invalid", now), null);
assert.equal(parseRetryAfter("", now), null);
assert.throws(() => parseRetryAfter("1", NaN), TypeError);
```

Group assertions into clearly named `test()` cases and import only the owned source module.

- [ ] **Step 5: Run the repository seed test and verify GREEN**

```bash
npx vitest run tests/evals/fixture-seed.test.ts
```

Expected: 2 tests pass while the fixture’s direct Node acceptance command remains intentionally red.

- [ ] **Step 6: Commit the immutable seed**

```bash
git add -- tests/evals/fixture-seed.test.ts evals/fixtures/independent-parallel/seed
git diff --cached --check
git commit -m "test: add independent parallel eval seed"
```

---

### Task 3: Implement safe reset with test-first path guards

**Files:**
- Create: `evals/scripts/lib.mjs`
- Create: `evals/scripts/reset-independent-parallel.mjs`
- Create: `tests/evals/helpers.ts`
- Create: `tests/evals/reset-independent-parallel.test.ts`

**Interfaces:**
- `tests/evals/helpers.ts` produces `createEvalTestRepository(): { repositoryRoot, destination, cleanup }` and `fixedNow(): Date`.
- Produces: `resetIndependentParallel(options): { worktree, seedCommit, manifestPath }`.
- `options`: `{ repositoryRoot: string, destination: string, now?: () => Date }`.
- Creates marker `.git/pi-super-messenger-eval-marker.json` and manifest `.git/pi-super-messenger-eval-run.json`.
- `lib.mjs` exports `assertSafeDescendant(root, target)`, `sha256File(path)`, `sha256Json(value)`, and `run(command, args, options)`.

- [ ] **Step 1: Write reset safety and success tests**

Create `tests/evals/helpers.ts`. `createEvalTestRepository()` must make an OS temporary root, copy the checked `evals/fixtures/independent-parallel` and `evals/profiles` directories beneath `path.join(temporaryRoot, "repo", "evals")`, create `path.join(temporaryRoot, "repo", "evals", "runs", "independent-parallel")`, return `path.join(temporaryRoot, "repo")` as `repositoryRoot`, set `destination` to its `worktree` child, and return a `cleanup()` that recursively removes the temporary root. `fixedNow()` returns `new Date("2026-07-27T12:00:00.000Z")`.

In every reset test, call the helper, register `cleanup` with `afterEach`, and destructure `repositoryRoot` and `destination` before using these examples:

```typescript
it("copies the seed, creates a clean seed commit, and records hashes", () => {
  const result = resetIndependentParallel({ repositoryRoot, destination, now: fixedNow });
  expect(existsSync(resolve(destination, ".git"))).toBe(true);
  expect(execFileSync("git", ["status", "--porcelain"], { cwd: destination, encoding: "utf8" })).toBe("");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  expect(manifest.fixture).toBe("independent-parallel");
  expect(Object.keys(manifest.testHashes)).toEqual([
    "test/duration.test.mjs", "test/format-bytes.test.mjs", "test/retry-after.test.mjs",
  ]);
  expect(manifest.seedCommit).toBe(result.seedCommit);
});

it("replaces only a previously marked run", () => {
  resetIndependentParallel({ repositoryRoot, destination });
  writeFileSync(resolve(destination, "discard-me"), "old");
  resetIndependentParallel({ repositoryRoot, destination });
  expect(existsSync(resolve(destination, "discard-me"))).toBe(false);
});
```

Also assert rejection of: run-root itself, repository root, fixture seed, outside-root destination, unmarked existing directory, destination symlink, and an existing symlink in any destination ancestor.

- [ ] **Step 2: Run the reset tests and verify RED**

```bash
npx vitest run tests/evals/reset-independent-parallel.test.ts
```

Expected: FAIL because `resetIndependentParallel` does not exist.

- [ ] **Step 3: Implement shared hashing, process, and path safety helpers**

`assertSafeDescendant(root, target)` must resolve both paths, require a nonempty relative path that does not begin with `..`, reject an absolute relative result, and walk every existing component from root to target with `lstatSync()` to reject symbolic links.

`run()` must use `spawnSync`, inherit a supplied environment, capture UTF-8 output, and throw an error containing command, exit status, stdout, and stderr on failure.

Hash helpers use SHA-256 over file bytes or canonical `JSON.stringify(value)`.

- [ ] **Step 4: Implement reset**

Implement this exact sequence:

1. Derive seed, profile, and allowed run root from `repositoryRoot`.
2. Validate `destination` with `assertSafeDescendant` and explicitly reject seed/repository paths.
3. If destination exists, require `.git/pi-super-messenger-eval-marker.json` with `{ "fixture": "independent-parallel" }` before recursive removal.
4. Copy the seed recursively.
5. Run `git init -b main`, configure local name/email, add all seed files, and commit `eval: seed independent parallel fixture`.
6. Compute seed commit, sorted test hashes, profile hash, and creation time.
7. Write marker and manifest under `.git/` after the commit so the worktree remains clean.
8. Return absolute paths and seed commit.

Add a CLI guard that defaults to `evals/runs/independent-parallel/worktree`, accepts at most one destination argument, prints the result as JSON, and sets `process.exitCode = 1` with a concise error on failure.

- [ ] **Step 5: Run reset tests and verify GREEN**

```bash
npx vitest run tests/evals/reset-independent-parallel.test.ts
```

Expected: all reset success and refusal tests pass.

- [ ] **Step 6: Commit safe reset tooling**

```bash
git add -- evals/scripts/lib.mjs evals/scripts/reset-independent-parallel.mjs tests/evals/helpers.ts tests/evals/reset-independent-parallel.test.ts
git diff --cached --check
git commit -m "feat: add safe independent eval reset"
```

---

### Task 4: Implement deterministic verifier with immutable-test enforcement

**Files:**
- Create: `evals/scripts/verify-independent-parallel.mjs`
- Modify: `tests/evals/helpers.ts`
- Create: `tests/evals/verify-independent-parallel.test.ts`

**Interfaces:**
- Consumes: reset marker/manifest from Task 3.
- Produces: `verifyIndependentParallel(options): VerificationResult`.
- `options`: `{ repositoryRoot: string, worktree: string }`.
- `VerificationResult`: `{ passed, testExitCode, seedCommit, headCommit, gitStatus, testHashes, stdout, stderr }`.
- Writes `.git/pi-super-messenger-eval-verification.json`.

- [ ] **Step 1: Write failing verifier tests**

Use `createEvalTestRepository()` and `resetIndependentParallel()` in each test, registering the returned cleanup exactly as in Task 3. Add `writeKnownCorrectImplementations(worktree)` to `tests/evals/helpers.ts`, export it, and import it into the verifier test. Cover:

```typescript
it("fails on untouched stubs", () => {
  expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/NOT_IMPLEMENTED/);
});

it("passes known-correct implementations", () => {
  writeKnownCorrectImplementations(worktree);
  const result = verifyIndependentParallel({ repositoryRoot, worktree });
  expect(result.passed).toBe(true);
  expect(result.testExitCode).toBe(0);
});

it("rejects modified acceptance tests before running them", () => {
  appendFileSync(resolve(worktree, "test/duration.test.mjs"), "\n// weakened\n");
  expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/test hash mismatch/);
});
```

Also cover deleted tests, additional `*.test.mjs` files, missing marker, profile-hash mismatch, and one remaining sentinel.

Define `writeKnownCorrectImplementations(worktree)` in the test file using complete general implementations:

```typescript
function writeKnownCorrectImplementations(worktree: string): void {
  writeFileSync(resolve(worktree, "src/duration.mjs"), `
export function parseDuration(input) {
  if (typeof input !== "string") throw new TypeError("duration must be a string");
  const match = input.trim().match(/^(\\d+(?:\\.\\d+)?)\\s*(ms|s|m|h)$/);
  if (!match) throw new TypeError("invalid duration");
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return Number(match[1]) * factors[match[2]];
}
`);
  writeFileSync(resolve(worktree, "src/format-bytes.mjs"), `
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0 || !Number.isInteger(bytes))
    throw new TypeError("bytes must be a finite nonnegative integer");
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const display = unit === 0 ? String(value) : String(Math.round(value * 10) / 10);
  return \`\${display} \${units[unit]}\`;
}
`);
  writeFileSync(resolve(worktree, "src/retry-after.mjs"), `
export function parseRetryAfter(value, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite");
  if (typeof value !== "string" || value.trim() === "") return null;
  const header = value.trim();
  if (/^\\d+$/.test(header)) return Number(header) * 1000;
  const target = Date.parse(header);
  return Number.isNaN(target) ? null : Math.max(0, target - nowMs);
}
`);
}
```

- [ ] **Step 2: Run verifier tests and verify RED**

```bash
npx vitest run tests/evals/verify-independent-parallel.test.ts
```

Expected: FAIL because the verifier module is missing.

- [ ] **Step 3: Implement deterministic verification**

Implement in this order:

1. Validate worktree is a safe descendant of `evals/runs/independent-parallel` or the injected test run root.
2. Require and parse marker and manifest.
3. Recompute the checked profile hash and compare it to the manifest.
4. Enumerate sorted `test/*.test.mjs`; require exact equality with manifest test paths.
5. Recompute every test hash and fail with the exact path on mismatch.
6. Require all three source files and reject the exact sentinel `NOT_IMPLEMENTED`.
7. Run `node --test` with the three explicit test paths, without a shell.
8. Read seed commit, HEAD, and `git status --porcelain`.
9. Write verification JSON under `.git/` on both pass and deterministic test failure.
10. Return on success; throw an error with retained stdout/stderr on failure.

The CLI accepts one optional worktree path, prints JSON on success, and prints the failure plus verifier-result path on error.

- [ ] **Step 4: Run verifier tests and verify GREEN**

```bash
npx vitest run tests/evals/verify-independent-parallel.test.ts
```

Expected: all verifier tests pass.

- [ ] **Step 5: Commit deterministic verification**

```bash
git add -- evals/scripts/verify-independent-parallel.mjs tests/evals/helpers.ts tests/evals/verify-independent-parallel.test.ts
git diff --cached --check
git commit -m "feat: verify independent eval deterministically"
```

---

### Task 5: Implement isolated stock runtime preparation and cleanup

**Files:**
- Create: `evals/scripts/prepare-stock-runtime.mjs`
- Create: `evals/scripts/cleanup-stock-runtime.mjs`
- Create: `tests/evals/stock-runtime-prepare.test.ts`
- Create: `tests/evals/stock-runtime-cleanup.test.ts`

**Interfaces:**
- Produces: `prepareStockRuntime(options): PreparedRuntime`.
- `options`: `{ repositoryRoot, sourceAgentDir, runtimeRoot, piCommand?: string }`.
- `PreparedRuntime`: `{ runtimeDir, packageSource, profileHash, launchCommand }`.
- Produces: `cleanupStockRuntime(options): { removed }`.
- Cleanup options: `{ runtimeRoot, runtimeDir }`; cleanup is deletion-only.
- Runtime marker: `.pi-super-messenger-stock-runtime.json`.
- Production preparation and cleanup derive their runtime root from a UID-scoped OS temporary root. `runtimeRoot` injection exists only in the exported test API; this fixed trust boundary supersedes the original example after security review.

- [ ] **Step 1: Write failing preparation and cleanup tests with a fake Pi executable**

Create an executable fake Pi script in the test temp directory. It must record argv and `PI_CODING_AGENT_DIR`; for `install`, write settings, and for `--list-models`, print all pinned models:

```javascript
#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.PI_CODING_AGENT_DIR;
if (!dir) process.exit(2);
appendFileSync(join(dir, "fake-pi-calls.jsonl"), JSON.stringify(process.argv.slice(2)) + "\n");
if (process.argv[2] === "install") {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [process.argv[3]] }));
} else if (process.argv[2] === "--list-models") {
  console.log([
    "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-luna",
  ].join("\n"));
} else {
  process.exit(3);
}
```

Set mode `0755` before passing its path as `piCommand`. Tests must prove:

- Fake `auth.json` and optional `models-store.json` are copied with mode `0600`.
- Install argv is exactly `install npm:pi-messenger@0.14.1`.
- Generated `settings.json` contains only the pinned package.
- Generated `pi-messenger.json` equals `{ "crew": { "models": profile.models, "concurrency": profile.concurrency, "planning": profile.planning, "review": profile.review, "work": profile.work, "coordination": profile.coordination, "artifacts": profile.artifacts } }`.
- Launch command sets `PI_CODING_AGENT_DIR`, changes to the reset worktree, and invokes `pi --model openai-codex/gpt-5.6-sol` without `--no-extensions`.
- Preparation rejects missing auth, pre-existing unmarked runtime, any installed Superpowers package, and missing pinned models.
- Cleanup removes a marked runtime.
- Cleanup refuses outside-root paths and missing markers.
- Cleanup never copies runtime evidence or creates paths under `evals/runs`.

- [ ] **Step 2: Run runtime tests and verify RED**

```bash
npx vitest run \
  tests/evals/stock-runtime-prepare.test.ts \
  tests/evals/stock-runtime-cleanup.test.ts
```

Expected: FAIL because preparation and cleanup modules are missing.

- [ ] **Step 3: Implement stock preparation**

Preparation must:

1. Compute `runtimeDir` with `resolve(runtimeRoot, "stock-pi-messenger-0.14.1")` and validate it with `assertSafeDescendant`.
2. Refuse any existing directory unless the caller has cleaned it explicitly.
3. Create the directory and marker before copying credentials.
4. Copy `auth.json` and optional `models-store.json`, then `chmod 0600` both.
5. Spawn the configured Pi command with `PI_CODING_AGENT_DIR=runtimeDir` and argv `install npm:pi-messenger@0.14.1`.
6. Parse settings and require the package list to contain exactly the pinned stock package and no string matching `/superpowers|crew-superpowers/i`.
7. Convert the eval profile into `{ crew: { ...profileWithoutPackage } }` and write `pi-messenger.json`.
8. Invoke `pi --list-models` without a model prompt and require all four profile models in output.
9. Write a non-secret preparation manifest containing package, profile hash, creation time, and expected worktree path.
10. Print, but never execute, a safely shell-quoted launch command using the isolated directory, reset worktree, and planner model as the control model.

On partial failure, retain the marked runtime and print its credential-bearing path for explicit cleanup.

- [ ] **Step 4: Implement safe cleanup**

Cleanup must validate runtime root/path/marker, recursively remove only the exact marked runtime, and confirm it no longer exists. Cleanup never retains or copies raw runtime evidence or creates paths under `evals/runs/`. Raw runtime evidence is inspectable only before cleanup, when an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`.

Add CLI parsing:

```text
node evals/scripts/prepare-stock-runtime.mjs --source-agent-dir /home/dominic/.pi/agent
RUNTIME_PATH=$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("evals/runs/independent-parallel/prepared-runtime.json", "utf8")); process.stdout.write(p.runtimeDir)')
node evals/scripts/cleanup-stock-runtime.mjs --runtime "$RUNTIME_PATH"
```

Unknown or repeated flags fail before mutation.

- [ ] **Step 5: Run runtime tests and verify GREEN**

```bash
npx vitest run \
  tests/evals/stock-runtime-prepare.test.ts \
  tests/evals/stock-runtime-cleanup.test.ts
```

Expected: all preparation, isolation, model-list, and deletion-only cleanup tests pass without real credentials, network calls, or model calls.

- [ ] **Step 6: Commit isolated runtime tooling**

```bash
git add -- \
  evals/scripts/prepare-stock-runtime.mjs \
  evals/scripts/cleanup-stock-runtime.mjs \
  tests/evals/stock-runtime-prepare.test.ts \
  tests/evals/stock-runtime-cleanup.test.ts
git diff --cached --check
git commit -m "feat: isolate stock eval runtime"
```

---

### Task 6: Integrate deterministic Phase 0 tooling

**Files:**
- Modify: `evals/README.md`
- Verify: all Phase 0 files

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: A documented, fully deterministic pre-model workflow and a clean feature branch ready for supervised baseline preparation.

- [ ] **Step 1: Run every focused eval-tooling test**

```bash
npx vitest run \
  tests/evals/definitions.test.ts \
  tests/evals/fixture-seed.test.ts \
  tests/evals/reset-independent-parallel.test.ts \
  tests/evals/verify-independent-parallel.test.ts \
  tests/evals/stock-runtime-prepare.test.ts \
  tests/evals/stock-runtime-cleanup.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the complete inherited suite**

```bash
npm test
```

Expected: all existing and new Vitest tests pass; no model process launches.

- [ ] **Step 3: Exercise reset and expected-red verification through the real CLI**

```bash
node evals/scripts/reset-independent-parallel.mjs
node evals/scripts/verify-independent-parallel.mjs
```

Expected: reset succeeds; verifier exits nonzero specifically because all three source files still contain `NOT_IMPLEMENTED`. This expected failure proves the real fixture begins red.

- [ ] **Step 4: Confirm secrets and generated runs remain untracked**

```bash
if git status --short --ignored | rg 'auth\.json|models-store\.json'; then exit 1; fi
git check-ignore evals/runs/independent-parallel/worktree/.git/pi-super-messenger-eval-run.json
git status --short
```

Expected: no credential file appears; generated run worktree is ignored; only intended documentation adjustments, if any, appear.

- [ ] **Step 5: Complete command examples and commit documentation adjustments**

Ensure `evals/README.md` matches the implemented CLI flags and default paths exactly, then:

```bash
git add -- evals/README.md
git diff --cached --check
git diff --cached --quiet || git commit -m "docs: document supervised eval workflow"
```

Expected: commit only if README required an implementation-alignment change.

---

### Task 7: Prepare the real supervised stock baseline

**Files:**
- Generated ignored: `evals/runs/independent-parallel/worktree/`
- Generated outside repository: stock runtime under the printed temporary root
- Do not modify committed result yet.

**Interfaces:**
- Consumes: Deterministically verified scripts and host `/home/dominic/.pi/agent/auth.json`.
- Produces: Reset worktree, isolated stock runtime, and printed launch command. No model call occurs in this task.

- [ ] **Step 1: Reset the real independent-parallel run**

```bash
node evals/scripts/reset-independent-parallel.mjs
```

Expected: JSON identifies the ignored worktree, seed commit, profile hash, and manifest path.

- [ ] **Step 2: Prepare stock runtime without launching a model**

```bash
set -o pipefail
node evals/scripts/prepare-stock-runtime.mjs \
  --source-agent-dir /home/dominic/.pi/agent \
  | tee evals/runs/independent-parallel/prepared-runtime.json
```

Expected: pinned package installed in the isolated runtime; package/profile/models verified; JSON containing `runtimeDir` and `launchCommand` is written to the ignored preparation record; no model request occurs.

**MANDATORY HUMAN CHECKPOINT:** Stop here. Show the user the runtime path, profile, fixture path, and exact launch command. Ask the user to run it in a separate terminal and supervise this sequence:

```text
1. Start Pi with the printed command.
2. Ask it to call pi_messenger plan using PRD.md with autoWork false.
3. Inspect the three-task decomposition and record deviations.
4. Call pi_messenger work with autonomous true and concurrency 3.
5. Observe until all work stops or reaches a terminal blocked state.
6. Exit Pi without deleting the runtime or eval worktree.
```

Do not continue until the user confirms the supervised run ended.

---

### Task 8: Verify, record, clean, and integrate the stock baseline

**Files:**
- Modify: `evals/results/stock-pi-messenger-0.14.1-independent-parallel.md`
- Optionally create a deliberately reviewed and sanitized excerpt under: `evals/runs/independent-parallel/evidence/stock-0.14.1-baseline/` before cleanup
- Modify: `docs/superpowers/plans/2026-07-27-phase-0-eval-foundation.md` through completed checkboxes

**Interfaces:**
- Consumes: Completed supervised run from Task 7.
- Produces: Committed stock baseline, removed credential runtime, all-green branch ready for review.

- [ ] **Step 1: Inspect run state before verification**

Record task files, Crew state, Git log, status, session counts, reviews, retries, failure state, timestamps, and available provider metadata from the run/runtime before cleanup. Do not infer missing observations; label them `not observable`.

- [ ] **Step 2: Run deterministic verification**

```bash
node evals/scripts/verify-independent-parallel.mjs
```

Expected for a functionally successful baseline: verifier exits 0, immutable tests match, stubs are gone, and all Node tests pass. If it fails, preserve the failure accurately; do not edit the fixture manually to manufacture a pass.

- [ ] **Step 3: Complete the durable baseline record**

Replace `Status: NOT RUN` with `Status: COMPLETE` or `Status: INCOMPLETE/FAILED`. Fill every template field using manifest, verifier, Crew state, provider metadata, and supervised observations. Record exact deviations and mark non-observable items explicitly. Raw runtime evidence is inspectable only before cleanup. Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`; review it for secrets before committing. Cleanup never retains or copies raw runtime evidence.

- [ ] **Step 4: Clean the credential-bearing runtime**

Read the exact runtime path from the ignored preparation record and clean it:

```bash
RUNTIME_PATH=$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("evals/runs/independent-parallel/prepared-runtime.json", "utf8")); process.stdout.write(p.runtimeDir)')
node evals/scripts/cleanup-stock-runtime.mjs --runtime "$RUNTIME_PATH"
```

Expected: runtime removed. Verify separately:

```bash
test ! -e "$RUNTIME_PATH/auth.json"
test ! -e "$RUNTIME_PATH"
```

- [ ] **Step 5: Run final deterministic verification**

```bash
npm test
node evals/scripts/verify-independent-parallel.mjs
git diff --check
```

Expected: full Vitest suite and fixture verifier pass for a successful baseline; for a recorded failed baseline, `npm test` must pass and the verifier’s expected failure must exactly match the durable result.

- [ ] **Step 6: Commit the completed baseline and plan record**

Mark all completed plan checkboxes accurately, then:

```bash
git add -- \
  evals/results/stock-pi-messenger-0.14.1-independent-parallel.md \
  docs/superpowers/plans/2026-07-27-phase-0-eval-foundation.md
git diff --cached --check
git commit -m "test: record stock independent parallel baseline"
```

- [ ] **Step 7: Request code review before integration**

Use `superpowers:requesting-code-review` to review the complete feature branch against:

- `docs/superpowers/specs/2026-07-27-phase-0-eval-foundation-design.md`
- this implementation plan
- exact branch diff from its `main` merge base

Resolve findings through TDD and rerun Task 8 Step 5.

- [ ] **Step 8: Finish the development branch**

Use `superpowers:finishing-a-development-branch` to present merge, pull-request, or keep-as-is options. Do not merge or push the feature branch without the user’s selected integration action.

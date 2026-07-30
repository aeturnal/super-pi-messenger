# Superpowers Runtime Provenance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept the exact fail-closed provenance shape emitted by stock Superpowers 6.2 during live Pi resource discovery and correct the supervised Crew-status command.

**Architecture:** Extend `captureSuperpowersSkills()` with one narrowly classified runtime-discovery candidate form. Derive its checkout root only from canonical stock paths, validate that root through the existing package checks, and require the official Git origin; do not trust the extension label alone or add new discovery. Keep the documentation correction separate from production behavior.

**Tech Stack:** TypeScript 5.9, Node.js 24 filesystem/path/child-process APIs, Vitest 4, Pi `Skill` metadata.

## Global Constraints

- Superpowers remains separately installed; do not copy or modify stock skill or extension files.
- Pi's `before_agent_start.systemPromptOptions.skills` remains the authoritative catalog; do not add filesystem skill discovery.
- Support only Superpowers major version `6`.
- Preserve silent inactive behavior and complete fail-closed fallback behavior.
- Preserve existing role mappings, prompts, warning behavior, orchestration, persistence, scheduling, and project-skill availability.
- Recognize only the exact runtime shape: source `extension:superpowers`, scope `temporary`, origin `top-level`, canonical base `<root>/.pi/extensions`, and canonical stock skill paths.
- Require an official `obra/superpowers` Git origin for runtime-discovered candidates.
- Do not merge, cherry-pick, clean, or modify the experimental Phase 1A worktree.
- Human-supervised active and silent-inactive runs remain release gates; no script may launch a model automatically.

## File map

- `tests/crew/superpowers.test.ts`: consumer-visible provenance acceptance and rejection regressions using real temporary package/Git fixtures.
- `crew/superpowers.ts`: candidate classification, canonical root derivation, shadow handling, and shared package validation.
- `evals/README.md`: corrected human commands for observing Crew integration state.

---

### Task 1: Validate stock runtime-discovered provenance

**Files:**
- Modify: `tests/crew/superpowers.test.ts`
- Modify: `crew/superpowers.ts`

**Interfaces:**
- Consumes: `captureSuperpowersSkills(skills: readonly Skill[]): SuperpowersState` and `createStockSuperpowersFixture()`.
- Produces: unchanged public interfaces; `captureSuperpowersSkills()` additionally accepts the exact validated `extension:superpowers` runtime metadata shape.

- [ ] **Step 1: Add a test helper that mirrors the captured live metadata completely**

Add `node:path` to the test imports and add this helper inside the existing `describe("Superpowers package validation", ...)` block, after `track()`:

```ts
  function asRuntimeDiscoveredSkills(
    fixture: StockSuperpowersFixture,
    origin = "https://github.com/obra/superpowers",
  ): Skill[] {
    execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", origin], {
      cwd: fixture.root,
      stdio: "ignore",
    });
    const extensionDir = path.join(fixture.root, ".pi", "extensions");
    return fixture.skills.map((skill) => ({
      ...skill,
      baseDir: path.dirname(skill.filePath),
      sourceInfo: {
        path: skill.filePath,
        source: "extension:superpowers",
        scope: "temporary",
        origin: "top-level",
        baseDir: extensionDir,
      },
    }));
  }
```

This test helper mirrors the actual runtime records captured during supervised acceptance. It does not enter production code.

- [ ] **Step 2: Write the failing live-runtime acceptance regression**

Add this test after the existing official Git-package acceptance test:

```ts
  it("accepts stock skills republished by the official runtime extension", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture);

    expect(captureSuperpowersSkills(skills)).toMatchObject({
      status: "active",
      version: "6.2.0",
      packageRoot: fs.realpathSync(fixture.root),
    });
  });
```

Production mutation caught: omitting recognition of Pi's runtime-discovered stock metadata leaves a genuine official installation in fallback.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/crew/superpowers.test.ts -t "accepts stock skills republished"
```

Expected: FAIL because `captureSuperpowersSkills()` returns fallback with reason containing `official Superpowers provenance` rather than active.

- [ ] **Step 4: Add rejection regressions before implementation**

Add these tests beside the acceptance regression:

```ts
  it("rejects a runtime extension label with an unofficial Git origin", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(
      fixture,
      "https://github.com/example/superpowers.git",
    );

    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it.each([
    ["scope", { scope: "project" as const }],
    ["origin", { origin: "package" as const }],
    ["source path", { path: "/tmp/not-stock-superpowers/skills/test/SKILL.md" }],
    ["base directory", { baseDir: "/tmp/not-stock-superpowers/.pi/extensions" }],
  ])("rejects runtime-discovered skills with malformed %s metadata", (_label, override) => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture).map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, ...override },
    }));

    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it("rejects a project shadow beside validated runtime-discovered skills", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture);
    const stockTdd = skills.find((skill) => skill.name === "test-driven-development");
    if (!stockTdd) throw new Error("fixture is missing test-driven-development");
    const shadow: Skill = {
      ...stockTdd,
      filePath: "/tmp/project/test-driven-development/SKILL.md",
      sourceInfo: {
        path: "/tmp/project/test-driven-development/SKILL.md",
        source: "/tmp/project",
        scope: "project",
        origin: "top-level",
        baseDir: "/tmp/project",
      },
    };

    expect(captureSuperpowersSkills([...skills, shadow])).toMatchObject({
      status: "fallback",
      reason: "shadowed",
    });
  });
```

Production mutations caught: trusting the extension label without Git validation; loosening exact metadata checks; or exempting all top-level skills from shadow detection.

- [ ] **Step 5: Run all new runtime tests and confirm only the intended acceptance path is RED**

Run:

```bash
npm test -- tests/crew/superpowers.test.ts -t "runtime|republished"
```

Expected: the official runtime acceptance test fails. Rejection tests pass under the existing fail-closed behavior. If any rejection test fails for fixture setup rather than returned behavior, correct the fixture and rerun before production changes.

- [ ] **Step 6: Implement the minimal runtime candidate classifier**

In `crew/superpowers.ts`, keep existing official-package and local-checkout classification. Add a runtime candidate list limited to stock names and the exact source/scope/origin tuple:

```ts
    const runtimeSkills = skills.filter(
      (skill) => skill.sourceInfo.source === "extension:superpowers"
        && skill.sourceInfo.scope === "temporary"
        && skill.sourceInfo.origin === "top-level"
        && STOCK_NAMES.some((name) => name === skill.name),
    );
```

Include `runtimeSkills` in `candidateSkills`. Keep candidate absence behavior unchanged.

For each runtime candidate, derive and validate its root before adding it to `candidateRoots`:

```ts
      if (runtimeSkills.includes(skill)) {
        const extensionDir = fs.realpathSync(baseDir);
        const candidateRoot = fs.realpathSync(path.resolve(extensionDir, "../.."));
        const expectedExtensionDir = fs.realpathSync(
          path.join(candidateRoot, ".pi", "extensions"),
        );
        const expectedSkillPath = path.join(
          candidateRoot,
          "skills",
          skill.name,
          "SKILL.md",
        );
        if (
          extensionDir !== expectedExtensionDir
          || fs.realpathSync(skill.filePath) !== expectedSkillPath
          || fs.realpathSync(skill.sourceInfo.path) !== expectedSkillPath
        ) {
          return fallback("invalid runtime-discovered Superpowers provenance");
        }
        if (!candidateRoots.includes(candidateRoot)) candidateRoots.push(candidateRoot);
        continue;
      }
```

For non-runtime candidates, retain the existing `sourceInfo.baseDir` root behavior. In the later required-skill canonical-path check, compare `sourceInfo.baseDir` with `<packageRoot>/.pi/extensions` for entries in `runtimeSkills`, and with `packageRoot` for every other candidate:

```ts
      const expectedBaseDir = runtimeSkills.includes(skill)
        ? path.join(packageRoot, ".pi", "extensions")
        : packageRoot;
      if (
        canonicalPath !== expectedPath
        || fs.realpathSync(skillBaseDir) !== fs.realpathSync(expectedBaseDir)
      ) {
        return fallback(`invalid canonical path for Superpowers skill: ${name}`, version);
      }
```

Exclude only recognized `runtimeSkills` entries from the generic project/top-level shadow predicate. Do not exempt official-package entries whose metadata was changed to project/top-level. Likewise, permit non-package origin only for entries in `runtimeSkills`.

Finally, remove the now-incomplete `localSource` sentinel and require Git-origin verification whenever there is no official Pi-package candidate:

```ts
    const requiresGitOriginVerification = officialSkills.length === 0;
```

Use that boolean in place of the current `localSource !== undefined` condition. Keep the current `git remote get-url origin` call and `isOfficialSource(origin)` validation unchanged.

- [ ] **Step 7: Run the focused package-validation suite and verify GREEN**

Run:

```bash
npm test -- tests/crew/superpowers.test.ts
```

Expected: PASS for all package, runtime, local-checkout, shadow, ambiguity, warning, role, and rendering tests.

- [ ] **Step 8: Run type checking and the full deterministic suite**

Run:

```bash
npm exec tsc -- --noEmit
npm test
```

Expected: TypeScript exits 0 and all tests pass with no unexpected warnings.

- [ ] **Step 9: Review the production diff for fail-closed scope**

Run:

```bash
git diff --check
git diff -- crew/superpowers.ts tests/crew/superpowers.test.ts
```

Confirm the diff adds only exact runtime classification/root validation, candidate-specific shadow exemption, Git-origin enforcement, and its tests. It must not alter stock files, role mappings, guidance, launch behavior, or warning semantics.

- [ ] **Step 10: Commit the runtime provenance fix**

```bash
git add crew/superpowers.ts tests/crew/superpowers.test.ts
git commit -m "fix: validate live Superpowers provenance"
```

---

### Task 2: Correct supervised Crew-status commands

**Files:**
- Modify: `evals/README.md`

**Interfaces:**
- Consumes: the existing `pi_messenger` action contract where `status` reports mesh presence and `crew.status` reports Crew and integration state.
- Produces: unambiguous active and silent-inactive operator instructions; no runtime interface changes.

- [ ] **Step 1: Correct both supervised command sequences**

In the active acceptance block, replace:

```text
# In Pi: run pi_messenger({ action: "status" }), then pi_messenger({ action: "work" }).
```

with:

```text
# In Pi: run pi_messenger({ action: "crew.status" }), then pi_messenger({ action: "work" }).
```

In the silent-inactive instructions, replace:

```text
`pi_messenger({ action: "status" })` and `pi_messenger({ action: "work" })`.
```

with:

```text
`pi_messenger({ action: "crew.status" })` and `pi_messenger({ action: "work" })`.
```

Human prose does not receive a source-text test. The observable runtime routing is already covered by existing status and Crew tests.

- [ ] **Step 2: Check the corrected instructions and formatting**

Run:

```bash
rg -n 'action: "(status|crew\.status)"' evals/README.md
git diff --check
git diff -- evals/README.md
```

Expected: the two acceptance instructions use `crew.status`; no acceptance instruction directs the operator to bare `status`; diff check exits 0.

- [ ] **Step 3: Commit the documentation correction**

```bash
git add evals/README.md
git commit -m "docs: use Crew status in integration acceptance"
```

---

## Final review and verification checkpoint

After both tasks are committed:

1. Request an independent review of the two implementation commits against `docs/superpowers/specs/2026-07-30-superpowers-runtime-provenance-fix-design.md`. Address only Critical or Important findings through fresh RED/GREEN cycles and focused commits.
2. Run fresh verification:

```bash
npm test
npm exec tsc -- --noEmit
git diff --check 57b8a0c..HEAD
git status --short
```

Expected: every test passes, TypeScript and diff checks exit 0, and the worktree is clean.
3. Remove the temporary diagnostics outside the repository:

```bash
rm -f \
  /tmp/pi-superpowers-skill-diagnostic.ts \
  /tmp/pi-superpowers-skill-metadata.json \
  /tmp/pi-superpowers-diagnostic-module-loaded \
  /tmp/pi-superpowers-diagnostic-registered \
  /tmp/pi-diagnostic-launch.out \
  /tmp/pi-diagnostic-launch.err
```

4. Reset the active fixture and repeat the human-supervised active acceptance from the corrected `evals/README.md`. Require `crew.status` to show active Superpowers 6.x before invoking `work`.
5. After active acceptance passes, perform a distinct fresh silent-inactive run. Only reviewed, sanitized evidence may enter `evals/results`; raw traces remain ignored under `evals/runs`.

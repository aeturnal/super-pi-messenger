# Phase 0 Eval Foundation Design

**Date:** 2026-07-27  
**Status:** Approved design awaiting written-spec review

## 1. Purpose

Complete the remaining Phase 0 baseline and fork-hygiene work before changing Pi Super Messenger runtime behavior.

This phase fixes three representative eval definitions, implements only the independent-parallel fixture, records a supervised stock `pi-messenger@0.14.1` baseline, and documents selective upstream maintenance. It creates evidence for later reliability, review, and repair changes without becoming a benchmark platform or product telemetry subsystem.

## 2. Scope and principles

Phase 0 must:

- Define all three initial eval tasks and their acceptance checks before related product work begins.
- Build only the independent-parallel fixture.
- Use deterministic reset and acceptance scripts around supervised model execution.
- Compare stock pi-messenger and the integrated fork on the same immutable fixture and model profile.
- Keep authentication and potentially sensitive raw runtime evidence out of Git.
- Record compact durable evidence without imposing token budgets or changing model behavior.
- Keep stock Obra Superpowers separately installed and copy none of its content.
- Treat upstream as an optional, read-only source of changes rather than a release dependency.

Phase 0 must not introduce a general eval runner, benchmark service, database, dashboard, automatic model launcher, product usage telemetry, or runtime feature change.

## 3. Repository structure

The eval kit will use this structure:

```text
evals/
  README.md
  definitions/
    independent-parallel.md
    shared-interface.md
    review-repair.md
  fixtures/
    independent-parallel/
      seed/
        PRD.md
        package.json
        src/
          duration.mjs
          format-bytes.mjs
          retry-after.mjs
        test/
          duration.test.mjs
          format-bytes.test.mjs
          retry-after.test.mjs
  profiles/
    stock-baseline.json
  scripts/
    reset-independent-parallel.mjs
    verify-independent-parallel.mjs
    prepare-stock-runtime.mjs
    cleanup-stock-runtime.mjs
  results/
    TEMPLATE.md
    stock-pi-messenger-0.14.1-independent-parallel.md
  runs/
    .gitignore
docs/
  upstream-maintenance.md
tests/
  evals/
    reset-independent-parallel.test.ts
    verify-independent-parallel.test.ts
    stock-runtime-prepare.test.ts
    stock-runtime-cleanup.test.ts
```

Responsibilities are intentionally narrow:

- `evals/definitions/` fixes task purposes, procedures, observations, and acceptance checks.
- `evals/fixtures/` contains immutable checked-in seed material.
- `evals/profiles/` contains non-secret, exact role and control settings used for comparisons.
- `evals/scripts/` resets, verifies, and isolates runs; it does not launch models automatically.
- `evals/results/` contains concise durable records.
- `evals/runs/` contains ignored active worktrees and any operator-created deliberately reviewed and sanitized excerpts.
- `tests/evals/` deterministically tests the tooling without making model calls.
- `docs/upstream-maintenance.md` defines selective upstream intake.

No npm script is required initially. The eval README will show explicit `node evals/scripts/...` commands so the workflow remains transparent.

## 4. Eval 1: independent parallel utilities

### 4.1 Purpose

Measure whether Crew can decompose, dispatch, implement, and review three genuinely independent tasks in one wave without artificial file overlap or nested orchestration.

### 4.2 Fixture

The seed is a dependency-free Node ESM project using the built-in `node:test` runner. It contains three implementation stubs and three failing test files.

The tasks are:

1. Implement `parseDuration(input)` in `src/duration.mjs`.
2. Implement `formatBytes(bytes)` in `src/format-bytes.mjs`.
3. Implement `parseRetryAfter(value, nowMs)` in `src/retry-after.mjs`.

Each task owns one source file. Fixture tests are immutable acceptance inputs and are not task-owned.

### 4.3 Utility contracts

`parseDuration(input)`:

- Accepts a string containing one nonnegative decimal number followed by `ms`, `s`, `m`, or `h`.
- Allows surrounding whitespace and whitespace between the number and unit.
- Returns milliseconds as a number.
- Supports examples including `250ms`, `5m`, and `1.5h`.
- Rejects empty input, negative values, compound durations, unsupported units, and non-string input with `TypeError`.

`formatBytes(bytes)`:

- Accepts a finite nonnegative integer.
- Uses binary units `B`, `KiB`, `MiB`, `GiB`, and `TiB`.
- Returns bytes without a decimal and larger units with at most one decimal, dropping a trailing `.0`.
- Produces examples including `0 B`, `1024 B` as `1 KiB`, and `1536 B` as `1.5 KiB`.
- Rejects negative, fractional, infinite, and non-number input with `TypeError`.

`parseRetryAfter(value, nowMs)`:

- Accepts an HTTP `Retry-After` string and a finite epoch-millisecond reference time.
- Returns a nonnegative delay in milliseconds.
- Treats an all-digit value as delta-seconds.
- Treats a valid HTTP date as an absolute time and clamps past dates to zero.
- Returns `null` for an empty or invalid header value.
- Rejects an invalid `nowMs` with `TypeError`.

### 4.4 Execution controls

- Worker concurrency is exactly three.
- Planning is reviewed at most once.
- Each task receives normal stock task review.
- Artifacts are disabled to avoid the already demonstrated raw snapshot amplification.
- The operator inspects the generated plan before starting work.
- A materially different decomposition is recorded rather than silently rewritten after the run.

### 4.5 Deterministic acceptance

The verifier requires:

- All three seed test hashes match the checked-in fixture.
- All three stubs have been replaced.
- `node --test` exits successfully.
- The worktree is a valid Git repository with the recorded seed commit.
- The run manifest identifies the exact fixture and profile hashes.

### 4.6 Supervised observations

The results record must state:

- Whether three independent tasks were dispatched in the same wave.
- Whether worker execution overlapped.
- Whether any file reservation conflict occurred.
- Whether each task was reviewed.
- Whether nested agents, controllers, worktrees, or orchestration were observed.
- Sessions by role, retries, review cycles, interventions, duration, and available provider usage metadata.

Stock behavior may fail future Pi Super Messenger orchestration criteria. The baseline is valid when it records the behavior accurately; it need not pretend that stock supports future integration review or scoped repair.

## 5. Eval 2: shared exported interface

The definition is committed in Phase 0; its fixture is built immediately before Phase 2 review-scope work.

The future fixture is a dependency-free record-codec library with an existing canonical record contract. Parallel workers implement a CSV codec and a JSON-lines codec against that contract without modifying it.

The definition fixes these checks:

- Each task owns only its codec and task-specific tests.
- Both codecs emit and consume the canonical record shape.
- Cross-codec round trips pass integration acceptance.
- Task reviewers receive only task-owned changes.
- A separate integration review examines the shared-contract interaction.
- Contract mismatches are not considered covered merely because each codec passes isolated tests.
- Nested orchestration, retries, interventions, review scope, and provider metadata are recorded.

The exact seed source and acceptance tests will be implemented in Phase 2 without changing this eval’s purpose or success criteria.

## 6. Eval 3: review and scoped repair

The definition is committed in Phase 0; its fixture is built immediately before Phase 3 repair-lifecycle work.

The future fixture begins with a completed task commit implementing `mergeSettings(defaults, overrides)`. The implementation returns the expected merged values but mutates caller-owned defaults despite an explicit immutability requirement. Visible task tests cover merged output but omit the mutation regression.

The definition fixes this lifecycle:

1. Review the completed task-owned commit.
2. Expect the reviewer to identify the mutation defect and return `NEEDS_WORK` because the core design remains sound.
3. Dispatch one scoped repair owning the relevant implementation and regression test.
4. Require the repair to preserve the core approach, avoid unrelated changes, and add mutation coverage.
5. Re-review the repair-owned changes plus a concise design sanity check.
6. Expect the final result to pass deterministic acceptance.

The eval fails its future product target if the reviewer misses the defect, the system restarts the complete task, more than one routine repair is launched, repair bypasses regression coverage, re-review ignores design validity, or nested orchestration occurs. A stock baseline may lack this lifecycle; that absence must be recorded honestly rather than emulated by undocumented manual steps.

## 7. Reset and verification design

### 7.1 Safe reset

`reset-independent-parallel.mjs` accepts an optional destination only under `evals/runs/independent-parallel/`.

It must:

- Resolve and validate the destination before deletion.
- Refuse the repository root, fixture seed, paths outside the allowed run root, symlink escapes, and existing directories without the expected marker.
- Remove only a marked prior eval worktree.
- Copy the immutable seed.
- Add an eval marker containing the fixture identity.
- Initialize Git, configure fixture-local test identity, add the seed, and create one seed commit.
- Write a run manifest containing fixture file hashes, test hashes, profile hash, seed commit, creation time, and empty result fields.

Resetting never modifies the checked-in seed.

### 7.2 Deterministic verifier

`verify-independent-parallel.mjs` accepts the run worktree path and:

- Validates its marker and run manifest.
- Recomputes seed test hashes and rejects modified, deleted, or additional acceptance tests.
- Confirms the expected three source paths exist and no longer contain their exact stub sentinel.
- Executes `node --test` in the run worktree without invoking npm installation or model tooling.
- Records command exit status and Git state in a verifier result.
- Exits nonzero when any deterministic check fails.

The verifier does not infer whether model work was parallel, well reviewed, or cost effective. Those observations belong in the supervised record.

## 8. Stock runtime isolation

### 8.1 Runtime location

The isolated stock agent directory lives outside the repository under the operating-system temporary directory, scoped to the current user and pinned package version. The script records its resolved path and refuses a path outside its designated temporary root.

### 8.2 Preparation

`prepare-stock-runtime.mjs` must:

- Accept an explicit source Pi agent directory, defaulting to the current configured directory or `~/.pi/agent`.
- Require readable `auth.json`; copy it with mode `0600`.
- Copy `models-store.json` when present, also with restrictive permissions.
- Never copy host `settings.json`, `pi-messenger.json`, extensions, skills, prompts, sessions, or Superpowers content.
- Create a minimal isolated Pi configuration.
- Install exactly pinned `npm:pi-messenger@0.14.1` into the isolated directory.
- Convert the checked eval profile into an isolated `pi-messenger.json` whose runtime settings are nested under the required `crew` key.
- Verify that the isolated package settings contain stock pi-messenger and no Superpowers or compatibility extension.
- Print the exact supervised launch command without executing Pi or making a model call.

### 8.3 Fixed stock profile

`evals/profiles/stock-baseline.json` contains no secrets and fixes:

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

The profile is an eval manifest, not a raw pi-messenger configuration file: `package` identifies what preparation installs, while `models`, `concurrency`, `planning`, `review`, `work`, `coordination`, and `artifacts` become fields inside `{ "crew": { ... } }` in the isolated `pi-messenger.json`.

If a pinned model is unavailable, preparation or the supervised launch stops. The operator must not silently substitute another model. A deliberate replacement requires a separately named profile and produces a different comparison series.

### 8.4 Cleanup

`cleanup-stock-runtime.mjs`:

- Resolves and validates the runtime against the designated temporary root.
- Is deletion-only and never copies runtime evidence into repository storage.
- Raw runtime evidence is inspectable only before cleanup. Cleanup never retains or copies raw runtime evidence. Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`.
- Removes the complete isolated runtime, including copied authentication.
- Refuses deletion outside the designated root or when its runtime marker is missing.

If cleanup fails, it reports the credential-bearing path prominently and exits nonzero.

## 9. Supervised baseline procedure

The operator follows this sequence:

1. Run the reset script.
2. Run the stock-runtime preparation script.
3. Confirm the printed runtime path, package version, profile hash, and absence of Superpowers.
4. Launch Pi interactively from the fixture using the isolated `PI_CODING_AGENT_DIR`.
5. Ask the control agent to invoke Crew planning from the fixture `PRD.md` with automatic work disabled.
6. Inspect and record the generated decomposition.
7. Start autonomous work with concurrency three.
8. Observe task waves, worker overlap, reservations, reviews, retries, and interventions.
9. Run the deterministic verifier.
10. Complete the stock baseline result from the run manifest and observations.
11. Before cleanup, manually create only deliberately reviewed and sanitized excerpts under ignored `evals/runs/` when useful.
12. Run deletion-only isolated-runtime cleanup and confirm authentication was removed.

The scripts never launch a model automatically. Model and credit use begins only when the operator deliberately executes the printed Pi command.

## 10. Evidence retention

### 10.1 Committed evidence

The Markdown result template and completed baseline record include:

- Run ID, date, operator, fixture version, seed commit, and final commit
- Stock package version and exact profile name/hash
- Functional and test-integrity outcomes
- Task, worker, reviewer, retry, and review-cycle counts
- Worker-overlap and reservation-conflict observations
- Unexpected nested orchestration
- Human interventions and wall-clock duration
- Important findings and escaped defects
- Available provider usage metadata
- Paths to deliberately reviewed and sanitized excerpts created under ignored run storage before cleanup
- Every deviation affecting comparison validity

### 10.2 Ignored evidence

`evals/runs/.gitignore` excludes reset worktrees, operator-created sanitized excerpts, Crew state, and generated manifests. The `.gitignore` file keeps the otherwise ignored directory tracked.

Authentication is never stored under `evals/runs/`, even temporarily. Raw runtime evidence is inspectable only before cleanup. Cleanup never retains or copies raw runtime evidence.

Before cleanup, an operator may manually create a deliberately reviewed and sanitized excerpt under ignored `evals/runs/`. Selected excerpts may be copied into a durable result only after review and secret removal.

## 11. Deterministic tooling tests

Vitest tests exercise tooling without model calls or real credentials:

- Reset creates the expected seed commit, marker, and hashes.
- Reset safely replaces a marked run.
- Reset rejects unmarked, outside-root, repository-root, fixture, and symlink-escape destinations.
- Verification begins red on untouched stubs.
- Verification passes on known-correct fixture implementations.
- Verification rejects changed tests and stub sentinels.
- Runtime preparation copies fake credentials with restrictive permissions into a temporary root.
- Runtime preparation uses a fake `pi` executable to prove the pinned install request and generated configuration.
- Runtime preparation rejects missing authentication, unexpected pre-existing runtime content, and settings containing Superpowers.
- Cleanup deletes only the marked fake runtime, creates no evidence path, and refuses unsafe paths or missing markers.

The normal `npm test` suite remains deterministic. Actual supervised model evals are never invoked by `npm test` or CI.

## 12. Upstream maintenance

`docs/upstream-maintenance.md` defines this process:

1. Fetch and prune the disabled-push `upstream` remote on demand.
2. Inspect new commits and releases without assuming they should be imported.
3. Record a candidate only when it addresses a Pi Super Messenger need or useful inherited maintenance.
4. Create a dedicated integration branch from current Pi Super Messenger `main`.
5. Import the smallest coherent upstream commit range while preserving authorship and attribution.
6. Review conflicts against the PRD, Superpowers compatibility boundary, and fork-specific behavior.
7. Run inherited unit tests and the relevant eval acceptance checks.
8. Merge only through the Pi Super Messenger review process.

`main` never tracks `upstream/main`, upstream changes are never merged automatically, and product progress never depends on upstream releases or acceptance.

## 13. Failure handling

- Any unsafe path fails before deletion.
- Any fixture hash mismatch fails before model work is judged successful.
- Any package, profile, or model substitution invalidates direct baseline comparison unless explicitly recorded as a new series.
- Missing authentication stops preparation without creating a partial credential copy.
- Partial runtime preparation remains marked and is removed through the cleanup command.
- Model quota, authentication, or provider failures are recorded as run outcomes and are not retried by eval tooling.
- A supervised run interrupted before completion remains an incomplete result; it is never presented as a passing baseline.
- Raw evidence or cleanup failures never cause credentials to be committed; cleanup never copies raw runtime evidence.

## 14. Phase 0 acceptance

Phase 0 is complete when:

1. All three eval definition files are committed with fixed tasks and acceptance checks.
2. The independent-parallel fixture resets reproducibly into a clean Git repository.
3. The untouched fixture deterministically fails and a known-correct implementation passes.
4. Fixture test mutation is detected.
5. Stock runtime preparation and cleanup are deterministically tested without model calls.
6. The supervised procedure isolates stock `pi-messenger@0.14.1` from Superpowers and the temporary compatibility extension.
7. One supervised stock independent-parallel baseline is completed and committed.
8. The result records exact models, deviations, outcomes, review behavior, retries, interventions, duration, and readily available provider usage metadata.
9. Raw runtime evidence is inspectable only before cleanup. Deletion-only cleanup removes copied authentication and never retains or copies raw runtime evidence.
10. Upstream monitoring and selective intake rules are documented.
11. Existing inherited tests and new deterministic eval-tooling tests pass.
12. No Superpowers content is copied or modified.

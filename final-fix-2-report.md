# Final Fix 2 Report

## Change

- Anchor the run manifest and run test hash to the trusted repository seed at `evals/fixtures/integration-mvp/seed/test/clamp.test.mjs`.
- Require `manifest.seedCommit` to be a full valid object ID, exist as a commit, be an ancestor of `HEAD`, and differ from `HEAD` before fixture tests run.
- Require worker evidence to be the exact `pi_messenger` call `{ action: "task.done", id: "task-1" }`.
- Reject direct `git worktree add`, `move`, `remove`, `lock`, `unlock`, `prune`, and `repair`; retain `git worktree list` as allowed.
- Update synthetic completed runs to commit only `src/clamp.mjs` before task state and trace evidence are written.

## Scope rationale

The implementation changes only the deterministic integration verifier and its integration eval test. The report is the sole additional artifact requested for release evidence. No framework, Git abstraction, test-order inference, or reviewer natural-language verdict inference was added. Tests-first ordering and reviewer verdict quality remain human-supervised raw-trace/template release gates. Same-name skill provenance policy is unchanged.

## TDD evidence

- RED: focused regressions failed for a mutable-manifest hash bypass, unchanged post-seed `HEAD`, wrong `pi_messenger` action, wrong task ID, and the newly forbidden worktree operations.
- RED: seed-commit regressions failed for malformed, wrong-length, nonexistent, and non-ancestor commit evidence.
- GREEN: `npm exec vitest -- run tests/evals/integration-mvp.test.ts tests/evals/definitions.test.ts` — 2 files, 95 tests passed.

## Verification

- `npm test` — 44 files, 586 tests passed.
- `npm exec tsc -- --noEmit` — passed.
- `git diff --check` — passed.

## Fix Round 2

- Scoped `forbidden` terminal classification to HTTP 403 and `unauthorized`/`authentication failed` classification to HTTP 401.
- Kept durable account, billing, credential, and exhausted-quota signals unchanged.
- Added regressions proving 400 and 429 messages containing `forbidden` or `unauthorized` remain retryable. Existing coverage keeps 403 `Forbidden` terminal and generic 429 rate limits retryable.

### TDD and verification

- RED: `npm exec vitest -- run tests/crew/agent-events.test.ts` failed the four new status-mismatch cases because the child received `SIGTERM`.
- GREEN: `npm exec vitest -- run tests/crew/agent-events.test.ts` — 1 file, 36 tests passed.
- `npm exec tsc -- --noEmit` — passed.
- `git diff --check` — passed.

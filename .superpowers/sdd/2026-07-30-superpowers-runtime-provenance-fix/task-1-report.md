# Task 1 Report

## Implemented
- Added a test helper that mirrors runtime-discovered `extension:superpowers` metadata for stock skills.
- Added acceptance and rejection regressions for runtime-discovered stock provenance.
- Updated `captureSuperpowersSkills()` to recognize validated runtime-discovered Superpowers skills, validate their package root and canonical paths, keep fail-closed shadow/provenance checks, and require Git-origin verification when no official package candidate exists.

## Files changed
- `tests/crew/superpowers.test.ts`
- `crew/superpowers.ts`

## RED
- Command: `npm test -- tests/crew/superpowers.test.ts -t "accepts stock skills republished"`
- Relevant failure: expected `status: "active"`, received `status: "fallback"`.
- Why expected: production code did not yet recognize stock skills republished through the runtime extension metadata.

## GREEN
- Command: `npm test -- tests/crew/superpowers.test.ts -t "runtime|republished"`
  - Result: `7 passed | 23 skipped`
- Command: `npm test -- tests/crew/superpowers.test.ts`
  - Result: `30 passed`

## Full suite and type-check
- Type-check: `npm exec tsc -- --noEmit` ✅
- Full suite: `npm test` ✅ `44 passed (596 tests)`

## Self-review findings
- Scope stayed limited to runtime provenance validation and matching regressions.
- Fail-closed behavior is preserved for malformed runtime metadata, unofficial Git origins, and shadowed required skills.
- Added tests cover the intended acceptance path plus rejection cases for malformed metadata and shadowing.
- Diff check was clean (`git diff --check`).

## Concerns
- None.

## Fix round 1
- Exact test added: `it("rejects a runtime extension label with a revision-like official origin suffix", ...)` in `tests/crew/superpowers.test.ts`.
- RED command: `npm test -- tests/crew/superpowers.test.ts -t "revision-like official origin suffix"`
  - Failing output: `expected { status: 'active', … } to match object { status: 'fallback' }` with the actual status still `active`.
- Implementation: added `isOfficialGitOrigin()` in `crew/superpowers.ts` and switched local/runtime Git-origin verification to it, preserving `normalizeOfficialSource()` for package-source matching.
- GREEN commands:
  - `npm test -- tests/crew/superpowers.test.ts -t "revision-like official origin suffix"` → `1 passed`
  - `npm test -- tests/crew/superpowers.test.ts` → `31 passed`
- Files changed: `crew/superpowers.ts`, `tests/crew/superpowers.test.ts`, `.superpowers/sdd/2026-07-30-superpowers-runtime-provenance-fix/task-1-report.md`.
- Self-review: change is narrow; strict matcher accepts official HTTPS/SSH/scp Git origins and rejects revision-suffix repo text.
- Concerns: none.

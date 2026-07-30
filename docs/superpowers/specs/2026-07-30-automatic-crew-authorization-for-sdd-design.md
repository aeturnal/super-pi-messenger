# Packaged Automatic Crew Authorization for Subagent-Driven Development

**Date:** 2026-07-30
**Status:** Approved

## Goal

When the controlling Pi agent determines that stock Superpowers `subagent-driven-development` applies, packaged Super Pi Messenger automatically authorizes Crew as the implementation and review dispatcher. The agent must not pause to request separate permission to use Crew.

## Scope

This is a packaged Super Pi Messenger feature. It replaces the temporary user-level `~/.pi/agent/extensions/crew-superpowers-policy.ts` setup and requires no new configuration field.

Stock Superpowers remains separately installed and unmodified. The feature adds no scheduler, event detector, session flag, command hook, automatic tool invocation, provider registry, or configuration subsystem.

## Activation

The policy activates by default only when the existing Super Pi Messenger provenance validator reports an active official Superpowers major-version-6 installation.

The policy is not injected when Superpowers is absent, invalid, ambiguous, unofficial, unsupported, or in fallback state. Existing silent-inactive and actionable-fallback behavior remains unchanged.

The controlling agent determines whether `subagent-driven-development` applies. Mere installation or catalog presence does not start Crew.

## Controlling-Agent Behavior

When `subagent-driven-development` is applicable, selected, or loaded:

1. Crew is already authorized.
2. The controlling agent proceeds without requesting separate Crew confirmation.
3. The controlling agent translates the skill's implementer and reviewer workflow into Crew planning and work.
4. Crew remains the sole implementation and review dispatcher.
5. The controlling agent must not launch nested agents, another subagent mechanism, nested plan executors, branch-finishing workflows, or nested worktree management.
6. If Crew is unavailable, the controlling agent reports that condition instead of silently substituting another dispatcher.
7. Automatic authorization does not mean unconditional execution. If no plan or ready work exists, the controlling agent may prepare or inspect required Crew state first.

For requests where `subagent-driven-development` does not apply, Crew planning or autonomous work still requires an explicit user request.

## Architecture

Create a focused packaged policy module at `crew/superpowers-policy.ts`. It owns:

- the package-owned outer-policy marker;
- rendering the controlling-agent policy;
- deciding whether the validated Superpowers state permits injection;
- idempotently appending the policy to the controlling agent's system prompt.

The existing `before_agent_start` lifecycle handler in `index.ts` will:

1. capture and validate Pi's authoritative loaded-skill catalog;
2. pass the resulting `SuperpowersState` and current system prompt to the packaged policy function;
3. return a modified system prompt only when active official v6 provenance permits it.

The policy function will also receive the child-process environment signal. It will not inject outer policy into dispatched Crew workers or reviewers. This avoids relying on extension-handler ordering.

The child guard will recognize and strip only the package-owned outer-policy marker as defense in depth. Its stock-bootstrap suppression remains unchanged.

## Marker and Idempotence

Use a package-owned marker that is not the temporary extension's legacy marker. Reapplying the packaged policy to a prompt containing that marker returns the prompt unchanged, preventing duplicate guidance.

No runtime compatibility, detection, replacement, warning, or migration logic will be added for `~/.pi/agent/extensions/crew-superpowers-policy.ts`. The standalone file will be removed before live acceptance. Existing legacy-marker compatibility code and tests will be replaced with package-marker behavior rather than carried forward.

## Files

- Create `crew/superpowers-policy.ts` for packaged outer-policy behavior.
- Modify `index.ts` to apply the policy after provenance capture.
- Modify `crew/superpowers-guard.ts` to use the package-owned marker.
- Add focused policy unit tests.
- Update extension lifecycle and child-guard tests.
- Update user documentation to describe automatic SDD-to-Crew authorization and removal of the standalone extension.

## Testing

Focused TDD coverage will prove:

1. Active official Superpowers v6 injects the packaged policy.
2. Inactive and fallback states leave the system prompt unchanged.
3. Dispatched Crew worker and reviewer environments do not receive outer policy.
4. Repeated application is idempotent.
5. The child guard strips the packaged outer policy.
6. The child guard no longer depends on the temporary legacy marker.
7. The extension lifecycle captures provenance before applying policy and returns the modified prompt.
8. Existing active, silent-inactive, fallback, worker, reviewer, and duplicate-guidance tests remain green.

## Release Process

1. Implement on a feature branch from current `main` using RED-GREEN TDD.
2. Run focused tests, the complete repository test suite, TypeScript checks, diff checks, and Pi Lens diagnostics.
3. Push the feature branch and open a pull request against `main`.
4. Wait for required GitHub CI and merge only after all required checks pass.
5. Update the installed Super Pi Messenger package to the merged revision.
6. Remove `~/.pi/agent/extensions/crew-superpowers-policy.ts`.
7. Start a fresh Pi session and verify that applicable `subagent-driven-development` proceeds through Crew without separate authorization.
8. Verify that a request where `subagent-driven-development` does not apply still does not start Crew without an explicit request.

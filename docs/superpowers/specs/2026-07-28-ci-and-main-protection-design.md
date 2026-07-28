# CI and Main Protection Design

**Date:** 2026-07-28

**Status:** Approved design awaiting implementation

## Context

This repository needs a repeatable, visible baseline check before changes reach `main`, plus branch settings that make that check and pull-request workflow enforceable. This design describes repository hygiene only; it does not change application behavior or release automation.

## Goals and non-goals

Goals:

- Support Node.js `>=24` and record the chosen npm version in `package.json` during implementation.
- Run one stable CI check named `test-and-typecheck` for pull requests and pushes to `main`.
- Require pull requests, that check, resolved review conversations, and protection against force-pushes and branch deletion on `main`.
- Permit solo maintenance by requiring zero approving reviews.

Non-goals:

- Release, publishing, versioning, or deployment automation.
- Changes to scripts other than recording the runtime/package-manager contract needed by this design.
- GitHub organization policy or protection of branches other than `main`.

## Package and runtime contract

Implementation will add a Node engine constraint of `>=24` and `packageManager: "npm@11.18.0"` to `package.json`. The workflow itself installs Node 24 and uses npm 11.18.0; `npm ci` uses the committed lockfile, so dependency resolution is reproducible from that lockfile.

## Workflow architecture

A later implementation will add `.github/workflows/ci.yml` with this shape:

- Triggers: `pull_request` and `push` limited to `main`.
- One job whose job/check name is exactly `test-and-typecheck`; this name is the durable branch-protection context.
- Runner steps, in order:
  1. Check out the repository.
  2. Set up Node 24 with npm dependency caching.
  3. Run `npm ci`.
  4. Run `npm test`.
  5. Run `npm exec tsc -- --noEmit`.

No matrix, separate lint job, artifact upload, deploy step, or release trigger is part of this workflow. Keeping validation in one job prevents branch protection from depending on multiple or changing check names.

## Validation and failure behavior

The exact CI commands are:

```bash
npm ci
npm test
npm exec tsc -- --noEmit
```

`npm ci` must fail for an incompatible or stale lockfile. A failing test command or TypeScript command fails `test-and-typecheck` and therefore prevents merging once the check is required. GitHub, checkout, setup, or npm-cache failures also fail the job rather than being ignored. If GitHub has not reported the expected check context, the required-check protection must remain disabled; substituting a similarly named check is not acceptable.

## Main branch protection and sequencing

After the workflow is committed, use this rollout sequence:

1. Open a pull request containing the workflow and allow `test-and-typecheck` to complete successfully (the `pull_request` trigger supplies the intended check context).
2. Merge it, then confirm a push to `main` also reports the same `test-and-typecheck` context.
3. **Only after GitHub has observed that exact check context**, configure protection for `main` to require it. Enabling a required check before GitHub has observed its context can create an unusable or incorrectly configured rule.
4. Verify the protected-branch behavior with a normal pull request.

Configure these `main` settings:

- Require a pull request before merging.
- Require the `test-and-typecheck` status check to pass before merging.
- Require resolved review conversations before merging.
- Set required approving reviews to `0`, preserving the pull-request path while allowing solo maintenance.
- Block force-pushes.
- Block branch deletion.

The stable required context is the job/check name, not a transient workflow run title. If the workflow or its check name must change later, first run and observe the replacement context, then update protection without a gap in required validation.

## Verification and rollout completion

Before enabling protection, run the three validation commands locally with Node 24 or later and confirm the pull-request workflow succeeds. After protection is configured, confirm in GitHub that `main` shows all listed settings and that a pull request displays `test-and-typecheck` as its required check. Exercise a failing validation change in a disposable pull request, confirm it cannot merge while the job fails, then close it without merging.

After implementation and GitHub configuration are complete, update `/tmp/super-pi-messenger-handoff.md` with the current commit and the CI/protection state. That handoff update is explicitly deferred from this design-only change.

## Risks

- Node 24 and its bundled npm distribution can change over time; pinning npm 11.18.0 keeps the CI contract inspectable and reproducible.
- A renamed job/check can silently break required-check enforcement unless the replacement is observed and protection is updated in sequence.
- Branch protection is GitHub-hosted configuration, so repository code review alone cannot prove it remains enabled; it needs post-configuration verification.

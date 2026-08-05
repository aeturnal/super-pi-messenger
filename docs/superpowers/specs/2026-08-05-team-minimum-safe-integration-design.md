# Team Minimum-Safe Integration Design

**Date:** 2026-08-05  
**Branch:** `integrate/upstream-v0.15.0-review`  
**Base:** `3315090afd87aa3c83b676006b6e322b433f5f1d`  
**Reviewed candidate:** `4eef26e78876ff75cb0ea46262a5a21a74448412`  
**Status:** Approved design; implementation not started

## Purpose

Keep the optional Team product layer while correcting the safety and execution defects that block integration. This milestone makes Team safe enough to retain without building a replacement scheduler or completing every possible Team improvement.

Crew remains the only execution engine. Team supplies roles, shared guidance, risk labels, approval state, and model preferences. Team must not create a second dispatch authority.

## Goals

1. Give every Crew child a strict, centralized action boundary.
2. Make Crew's `work` lifecycle the sole owner of automatic execution.
3. Make Team approval impossible to bypass through revision or alternate launch paths.
4. Apply one concurrency, ownership, completion, review, and retry lifecycle to fresh and warm workers.
5. Preserve Team for later development while limiting this milestone to merge-blocking correctness.

## Non-goals

This milestone does not add:

- A replacement scheduler, durable lease system, or process manager.
- Cross-process atomic task ownership.
- A full redesign of Team profiles, charter, or memory.
- A complete operating-system-level sandbox for read-only roles.
- Durable provider quota pause and recovery.
- Broad installer or TypeBox compatibility work unless required for this integration.
- Strict SDD dependency mode from `feat/parallel-sdd-crew`.

## Architecture

The integration will use two shared boundaries: a child action boundary and a work lifecycle boundary.

### Child action boundary

Every `pi_messenger` request from a Crew child passes through one permission check before action routing. Child identity uses all trusted Crew markers, not only the conditional Superpowers activation flag.

Crew children may:

- Read status, tasks, feed, and worker information.
- Send direct and broadcast messages.
- Reserve and release files.
- Report progress for their own assigned task.
- Complete only their own assigned task.

Crew children may not:

- Create or replace plans.
- Start or stop project-wide work.
- Start reviews, synchronization, or revision workflows.
- Create, split, reset, delete, approve, reject, or otherwise restructure tasks.
- Change Team setup, profiles, charter, memory, roles, or approval policy.
- Start nested Crew, Pi, worktree, branch-finishing, or other dispatch workflows.

The controller retains these actions. The allowlist is fail-closed: a new action is unavailable to children until it is deliberately classified and tested.

Prompt guidance remains defense in depth. Permission checks, not prompts, enforce the boundary.

### Work lifecycle boundary

Crew's `work` lifecycle is the sole owner of automatic execution. It performs this sequence:

1. Select dependency-ready tasks that Team permits to run.
2. Calculate one effective concurrency budget.
3. Match compatible warm lobby workers within that budget.
4. Launch fresh workers for remaining slots.
5. Track every assigned worker until terminal exit.
6. Verify ownership and task completion.
7. Run exactly one automatic review for each successful automatic implementation.
8. Accept, retry, or block the task from the result and review verdict.
9. Continue autonomous work only after reviewed results update readiness.

Overlay rendering does not start or refill workers. It displays current state and submits explicit user actions. Planning with `autoWork: false` therefore creates tasks and returns control without starting workers.

## Team and task rules

### Approval

Tasks marked as pending approval or rejected are not startable.

When `task.revise-tree` creates replacement tasks, Crew:

1. Classifies each new task under the current Team profile.
2. Assigns its role and risk labels.
3. Computes its normal approval requirement.
4. Preserves the stronger gate when the source subtree was gated or rejected.
5. Requires fresh controller approval before a gated replacement can run.

Revision cannot transform rejected or approval-gated work into ordinary ungated work.

### Lobby compatibility

Each warm lobby worker records:

- Resolved provider and model.
- Whether Superpowers guidance is active and which worker guidance contract it uses.
- Team role and capability type.
- Normalized project working directory.

Crew assigns a task to a warm worker only when these values satisfy the task's resolved requirements. Otherwise, Crew starts a fresh worker. Assignment compatibility is checked before task ownership changes.

Lobby workers use the same child identity, Superpowers guard, and trusted worker launch composition as fresh workers. They never receive controller-only outer policy.

### Ownership

Only the assigned worker may update protected execution state or complete its task. Controller actions may override ownership for explicit recovery.

An active task cannot be split, reset, deleted, or revised while its worker is alive. Failed validation leaves the task unchanged.

This milestone preserves the current process-local ownership model. Cross-process atomic claims are deferred and remain a documented residual risk.

## Failure, review, and stop behavior

### Worker exit

Fresh and warm workers follow the same rules:

- A successful process that completes its assigned task proceeds to review.
- A crash or failed process clears dead ownership and returns the task to `todo` while attempts remain.
- The task becomes blocked after its configured attempt limit.
- A task never remains assigned to a dead worker.

### Review

- `SHIP`: the task remains `done`; dependents may become ready.
- `NEEDS_WORK`: the task returns to `todo` for a bounded retry.
- `MAJOR_RETHINK`: the task becomes blocked.
- Reviewer failure or exhausted review attempts: the task becomes blocked or requires explicit controller action.

No automatic execution path treats unreviewed work as accepted when review is enabled. Each successful automatic implementation receives exactly one review attempt per review iteration.

### Stop

Stopping automatic work:

- Revokes permission to dispatch new workers.
- Prevents any overlay refill.
- Preserves already accepted work.
- Stops or safely releases active workers through the existing explicit stop behavior.
- Clears pending automatic continuation so rendering or later callbacks cannot restart work.

### Provider errors

Temporary rate limits, including generic `429 Too Many Requests`, remain retryable through normal Pi handling. Immediate termination is limited to clear durable authentication, account, billing, or exhausted-quota failures. Classification tests must include positive and negative examples.

## Required tests

### Child permissions

- Every child role and marker combination uses the strict allowlist.
- Children cannot plan, dispatch, review, revise, synchronize, administer Team, approve, reject, or mutate another task.
- New actions are denied by default.
- Controller actions retain existing behavior.
- A child can update and complete only its own assigned task.

### Dispatch and overlay

- `autoWork: false` leaves every task untouched after repeated overlay renders.
- Overlay rendering never starts or refills workers.
- Explicit and autonomous `work` start approved ready tasks.
- Stopping automatic work prevents later continuation or refill.

### Lobby and concurrency

- Warm and fresh workers share one effective concurrency budget.
- Incompatible lobby workers are skipped without mutating task ownership.
- Compatible lobby workers receive the correct project, model, Team role, child identity, Superpowers guidance, and guard.
- Lobby-backed autonomous work remains owned until worker completion and review.

### Completion, retry, and review

- Only the assigned worker can complete a task.
- Every successful automatic completion receives exactly one review.
- Worker crashes clear stale ownership and retry only while attempts remain.
- Reviewer failure never silently accepts a task.
- `NEEDS_WORK` and `MAJOR_RETHINK` preserve dependency gates.
- Active tasks cannot be split, reset, deleted, or revised.

### Team approval

- Revision-created tasks are classified under current Team policy.
- A gated or rejected source subtree produces gated replacements.
- Rejected replacement tasks cannot be dispatched before fresh controller approval.

### Provider handling

- Generic temporary 429 errors remain retryable.
- Clear authentication, billing, and exhausted-quota failures terminate promptly.
- Ordinary assistant text and tool output cannot trigger terminal classification.

## Verification gates

Before integration review:

- Focused RED/GREEN evidence for every corrected behavior.
- TypeScript compilation succeeds.
- Complete Vitest suite succeeds.
- Deterministic eval suite succeeds.
- Primary LSP diagnostics are clean on changed TypeScript files.
- Lens `mode=all` is clean for changed files.
- `git diff --check` is clean.
- Independent whole-branch review reports no unresolved Critical or Important findings.
- A feature branch is pushed and reviewed through a pull request.
- Required GitHub `test-and-typecheck` passes before merge.

No publication or package release is part of this milestone.

## Later Team work

After this integration is stable, separate designs may address:

- Strong read-only capability profiles for scout and reviewer roles.
- Trust and provenance rules for project-supplied role prompts and Team memory.
- Cross-process atomic task claims.
- Richer Team profile and approval workflows.
- Durable provider pause and recovery.
- Broader installer and provider compatibility.

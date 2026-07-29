# Superpowers Integration MVP Design

**Date:** 2026-07-29
**Status:** Approved design awaiting written-spec review

## Context and scope

The first useful Super Pi Messenger release is a thin integration between the existing pi-messenger Crew runtime and a separately installed stock Obra Superpowers package. Pi-messenger remains the sole Crew orchestrator. Superpowers supplies focused engineering guidance without starting its standalone planning, agent-dispatch, worktree, or branch-finishing workflows inside dispatched Crew agents.

The MVP supports only existing Crew workers and reviewers:

- Workers start with `test-driven-development` and `verification-before-completion`.
- Reviewers start with `verification-before-completion` while retaining the existing `crew-reviewer` rubric.
- All other Pi-loaded user, project, and package skills remain discoverable and usable when relevant.

Specialized bug, repair, planner, analyst, and integration-reviewer guidance is deferred. The MVP does not redesign scheduling, task persistence, attempts, retries, review scope, repair, recovery, artifacts, planning, routing, or provider APIs.

## Architecture

The implementation has two narrow parts:

1. A concrete parent-side adapter selects and renders Superpowers guidance at the existing `spawnAgents()` boundary.
2. A child-only compatibility guard suppresses the stock standalone Superpowers bootstrap in active supported Crew children.

A focused module, tentatively `crew/superpowers.ts`, owns resource normalization, provenance checks, compatibility state, role selection, per-launch records, rendering, warning deduplication, and the latest in-memory status snapshot. Its selection and rendering logic should remain pure; a small state wrapper may hold the current catalog and latest launch record.

The root extension captures Pi's authoritative loaded `Skill[]` from `before_agent_start.systemPromptOptions.skills`. This uses Pi's package filtering, precedence, paths, and project settings instead of reimplementing discovery. The parent turn's `before_agent_start` occurs before a Crew tool call can dispatch a worker or reviewer.

The adapter has no public generic-provider interface or registry. A provider abstraction may be considered only after a second concrete provider or demonstrated duplication establishes a real shared boundary.

## Supported Superpowers provenance

A selected skill counts as stock Superpowers only when all required skills resolve under one package root identified as one of:

- Pi package metadata for the official `obra/superpowers` Git source; or
- A local Git checkout with `package.json` name `superpowers`, the expected Pi package structure, and an `origin` URL that normalizes to official `obra/superpowers`.

HTTPS, SSH, and Pi's normalized Git source forms for the official repository are equivalent. A copied directory, modified fork with another origin, or project skill that merely reuses a required skill name does not satisfy provenance.

The package root must provide readable metadata, a supported tested major version, the expected stock bootstrap marker, and every required skill at its loaded canonical path. The initial tested major is Superpowers 6. Version compatibility is represented as a small explicit constant and parser, not a compatibility framework.

If a project or user skill shadows an official required skill, the adapter fails closed rather than selecting a same-named untrusted file. Multiple conflicting official roots also fail closed.

## Compatibility states

The adapter returns one complete result before any launch argument or prompt is changed:

- `inactive`: no stock Superpowers installation is loaded. Crew remains silent and native.
- `active`: one compatible stock installation and all MVP resources validate.
- `fallback`: Superpowers appears present but provenance, version, bootstrap compatibility, or required resources cannot be validated.

An unexpected adapter exception is converted to `fallback`. There is no partially active state. Fallback appends no policy guidance and adds no child guard.

A fallback reason must be actionable and bounded, for example:

- unsupported Superpowers major version;
- missing `test-driven-development`;
- required skill shadowed by a project path;
- conflicting package roots; or
- unrecognized stock bootstrap compatibility marker.

## Role selection

The active role mapping is deliberately small.

### Worker

- `test-driven-development`
  - Reason: apply RED-GREEN-REFACTOR to behavior changes.
- `verification-before-completion`
  - Reason: run fresh checks before completion claims.

### Reviewer

- `verification-before-completion`
  - Reason: verify evidence supporting the review verdict.
- The existing `crew-reviewer` system prompt remains the review rubric.

The adapter validates the union of required MVP skills before activation. It does not activate reviewer guidance alone when worker requirements are incomplete.

Unknown or unrelated skills remain in Pi's normal catalog. Required starting guidance does not disable, hide, or replace project-specific skills. It only prevents other skills from taking over Crew-owned orchestration.

## Per-launch selection record

Before an active supported launch, the adapter creates an immutable in-memory record:

```text
{
  status: "active",
  role: "worker" | "reviewer",
  assignmentId?: string,
  packageVersion: string,
  packageRoot: string,
  selectedSkills: [
    { name, filePath, reason }
  ],
  prohibitedWorkflows: string[]
}
```

`assignmentId` uses the task ID or existing assignment context when available. The record contains metadata only, never skill bodies or the complete system prompt. Only the latest record is retained for minimal status; durable persistence is deferred.

## Prompt composition

For an active worker or reviewer launch, `spawnAgents()`:

1. Builds the existing project-overridable agent system prompt exactly as today.
2. Produces the complete adapter selection.
3. Appends one compact Crew/Superpowers section after the existing agent prompt.
4. Sets an explicit supported `PI_CREW_ROLE` and an adapter activation flag.
5. Adds the child compatibility guard after the normal pi-messenger extension.

The appended section states:

- Pi-messenger Crew is the sole orchestrator and task authority.
- The agent must continue in the checkout assigned by Crew.
- The agent should read each selected starting skill from its resolved installed path before acting.
- The agent must not start nested agents, SDD controllers, plan executors, branch-finishing workflows, or create, switch to, or manage nested worktrees.
- Other relevant installed skills remain available.

Operating inside a user- or Crew-assigned worktree is allowed. Only creating or changing to an unmanaged nested worktree is prohibited.

When the adapter is inactive or in fallback, the existing prompt and launch arguments remain unchanged. Existing project agent overrides, models, tools, task prompts, task state, review behavior, and scheduling remain authoritative.

## Child compatibility guard

Stock Superpowers injects a standalone `using-superpowers` bootstrap into new Pi sessions. That behavior is correct outside Crew but conflicts with an already dispatched Crew assignment.

For active supported launches only, the parent adds a tiny final CLI extension to the child process. The guard:

- requires the adapter activation flag and a supported `PI_CREW_ROLE`;
- removes only a context message containing the exact stock marker `superpowers:using-superpowers bootstrap for pi`;
- leaves every other message untouched;
- does not alter Pi's loaded skills or commands;
- does not run in outer interactive sessions, unsupported Crew roles, inactive mode, or fallback mode; and
- never modifies files in the stock Superpowers installation.

Loading the guard after normal package extensions ensures it observes the stock bootstrap contribution. Focused integration and live tests must verify this ordering assumption. If a supported Pi release no longer provides that behavior, compatibility fails closed until the guard is adapted.

The selected TDD and verification instructions are then supplied through the Crew system prompt, while all other loaded skills remain available through Pi's normal progressive-disclosure mechanism.

## Warning and status behavior

No warning is shown when Superpowers is absent.

When a supported worker or reviewer launch is attempted in `fallback`, Crew continues with native behavior and surfaces one actionable warning containing the reason and corrective action. A process-memory fingerprint suppresses repeated warnings for the same condition. A materially changed reason may warn again. The warning mechanism must work in non-interactive tool output as well as interactive UI; UI notification is additive rather than the only signal.

Existing `crew status` output gains a compact `Superpowers integration` section:

```text
Superpowers integration: active (6.2.0)
Worker: test-driven-development, verification-before-completion
Reviewer: verification-before-completion
Last launch: worker TASK-3
Restrictions: no nested orchestration or nested worktree management
```

Fallback status shows its actionable reason. Inactive status is a single non-warning line. Status does not print skill contents or complete prompts.

## Testing strategy

Implementation follows focused TDD.

### Discovery and compatibility tests

- Official Git package metadata activates.
- An official local checkout activates.
- No Superpowers produces silent `inactive`.
- Wrong provenance, unsupported major, unreadable metadata, conflicting roots, missing required skills, bootstrap-marker mismatch, and required-skill shadowing produce complete `fallback`.
- Exceptions produce complete `fallback` without partial output.

### Role and rendering tests

- Worker selection is exactly TDD plus verification.
- Reviewer selection is exactly verification.
- Selected paths are the actual loaded canonical paths.
- Rendered guidance includes reasons and bounded Crew ownership rules.
- The guidance permits other relevant skills and working inside the assigned checkout.
- The guidance prohibits nested orchestration and nested worktree management.
- Rendering is deterministic and smaller than the previous global role matrix.

### Launch tests

- Active launches preserve and then supplement project agent overrides.
- Active worker and reviewer launches receive explicit role metadata and the final guard extension.
- Inactive and fallback launches preserve native prompt and launch arguments.
- The complete selection is built before mutation.
- Existing model, tool, task, review, and scheduling behavior remains unchanged.

### Guard tests

- The guard removes only the exact stock bootstrap message in an active supported Crew child.
- It preserves adjacent user, system, compaction, and tool messages.
- It does nothing without the activation flag, for unsupported roles, or when the marker is absent.

### Status and warning tests

- Status renders active, inactive, and fallback compactly.
- The latest launch record is inspectable without prompt persistence.
- Fallback warns once per unchanged reason and includes corrective action.
- Non-interactive results contain the warning.

## Live acceptance

After deterministic tests pass, run a resettable representative Crew fixture and record evidence that:

- a worker can read and follow the selected TDD and verification skills;
- the required `pi_messenger` tool is available;
- the worker does not launch agents or create/manage another worktree;
- the worker can still discover and use an unrelated project skill;
- a reviewer produces an evidence-backed verdict without dispatching another reviewer; and
- removing or disabling Superpowers returns Crew to native behavior without warning.

Inspect JSON event/tool traces and repository state rather than trusting agent prose alone. If acceptance reproduces the known `pi_messenger` tool-contract inconsistency, stop the MVP acceptance run and approve only the smallest focused correction backed by a failing test. Do not import the experimental execution-platform branch.

## Delivery boundaries and risks

The implementation plan should use small RED/GREEN tasks with one coherent reviewer gate and one commit each. The adapter, launch integration/guard, status/warnings, and live fixture are separate reviewable concerns, but no production-only foundation should be presented as a usable milestone before its consuming path exists.

Primary risks and controls:

- **Pi resource lifecycle changes:** use authoritative `Skill[]` and focused lifecycle tests.
- **Extension ordering changes:** final child guard plus live marker-removal acceptance; fail closed on incompatibility.
- **Prompt conflicts:** remove only the marked standalone bootstrap and keep Crew ownership in system guidance.
- **False stock identification:** require one official root and fail closed on shadowing or ambiguity.
- **Scope expansion:** reject scheduler, persistence, repair, recovery, planner, routing, and generic-provider work from this MVP.

The MVP is complete only when deterministic tests, the inherited suite, type checks, focused diagnostics, and representative live acceptance all pass, and `crew status` makes activation or fallback understandable.

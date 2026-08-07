# Deterministic Superpowers-to-Crew Handoff Design

## Goal

Ensure that when Superpowers `subagent-driven-development` delegates execution to Crew:

1. the Crew planner receives the exact implementation plan written by the Superpowers `writing-plans` workflow; and
2. every Crew child process—including planners, workers, lobby workers, reviewers, revision planners, and plan-sync analysts—operates in the exact Git worktree selected by the controlling Superpowers workflow.

## Current Problems

### Implementation-plan ambiguity

Superpowers writes implementation plans under `docs/superpowers/plans/`. Crew's bare `plan` action does not search that directory. It auto-discovers only fixed names such as `PRD.md`, `SPEC.md`, `DESIGN.md`, and `PLAN.md` in selected locations.

The controlling-agent compatibility policy currently says to translate the Superpowers workflow into Crew planning and work, but it does not state how to carry the implementation plan into Crew. A controlling agent can therefore call a bare Crew `plan` action or pass a summary. In either case, the Crew planner may not receive the approved implementation plan.

### Worktree ambiguity

Fresh Crew child processes currently inherit the `cwd` supplied by the controlling Pi session. Lobby workers are also associated with a `cwd`. This makes the normal path likely to work, but it does not establish an explicit, durable contract for which worktree is authoritative.

A wrong controlling-session directory could therefore become the child process directory. Child prompts also do not consistently name or verify the expected worktree. Mentioning a directory only in a prompt would not be sufficient because the prompt could confidently repeat an incorrect location.

## Design

### 1. Explicit implementation-plan handoff

Strengthen the packaged controlling-agent policy in `crew/superpowers-policy.ts` with this contract:

1. When `writing-plans` has produced an implementation plan and `subagent-driven-development` selects Crew, the controlling agent must retain the exact plan path reported by `writing-plans`.
2. The controlling agent must pass that exact path through Crew's existing `prd` field.
3. For this handoff, the controlling agent must not call a bare `pi_messenger({ action: "plan" })` and must not replace the implementation plan with an inline summary.

### 2. Explicit worktree handoff

Add a `workspace` field to the Crew `plan` action. For a Superpowers handoff, the controlling agent must invoke Crew only after Superpowers has created or entered the isolated worktree, and it must pass the worktree's absolute path:

```ts
pi_messenger({
  action: "plan",
  prd: "docs/superpowers/plans/<exact-plan-file>.md",
  workspace: "/absolute/path/to/the/linked-worktree"
})
```

The compatibility policy must prohibit starting this Crew handoff before entering the worktree and must prohibit omitting `workspace`.

Crew does not create, switch, or remove worktrees. Superpowers remains responsible for worktree lifecycle. This prevents nested or competing worktree management.

### 3. Canonical workspace identity

Introduce one focused workspace module responsible for resolving and verifying workspace identity. The identity contains:

- canonical worktree root from `realpath` and `git rev-parse --show-toplevel`;
- worktree-specific Git directory from `git rev-parse --git-dir`;
- shared Git directory from `git rev-parse --git-common-dir`.

A valid Superpowers workspace must:

- exist and be a directory;
- be a Git checkout;
- be a linked worktree rather than the repository's main checkout;
- not be a Git submodule mistaken for a linked worktree;
- canonically equal the controlling Pi session's `cwd` and Git top-level directory.

Crew stores this canonical identity in plan metadata. It does not use the branch name or commit hash as identity because commits change during implementation and a harness-managed worktree may initially use detached `HEAD`.

### 4. Plan containment

When `workspace` is supplied, the explicit `prd` file must resolve inside the canonical workspace. Crew rejects paths that resolve outside it, including traversal paths and symlinks that escape the worktree.

Crew then reads the plan, embeds its exact path and contents in the planner prompt, and retains the source path in plan metadata.

### 5. Verification before every child launch

For a plan with stored workspace identity, before launching or assigning any planner, worker, lobby worker, reviewer, revision planner, or plan-sync analyst, Crew must compare the current workspace with that identity. Verification must occur before task state is committed to an active assignment wherever possible.

A child may launch only when:

- the current canonical `cwd` equals the stored worktree root;
- the current worktree-specific Git directory equals the stored Git directory; and
- the current shared Git directory equals the stored common Git directory.

The worktree-specific Git directory prevents a different worktree from being accepted merely because it belongs to the same repository.

Lobby workers must carry the same workspace identity. They may accept assignments only when their stored identity exactly matches the task plan's identity.

### 6. Child-process enforcement and awareness

Every Crew child receives the authoritative workspace through three independent channels:

1. **Operating-system enforcement:** spawn the process with the canonical worktree root as `cwd`.
2. **Environment:** set `PI_CREW_WORKSPACE_ROOT` to the canonical root.
3. **System guidance:** append a common workspace section to every Crew child system prompt. It names the authoritative root, forbids editing outside it, and requires checking `git rev-parse --show-toplevel` before the first edit.

The prompt must tell the child to stop and report a block if its observed top-level directory differs from `PI_CREW_WORKSPACE_ROOT`. Prompt guidance supplements runtime verification; it does not replace it.

## Data Flow

1. `writing-plans` saves and reports the exact implementation-plan path.
2. Superpowers creates or enters an isolated linked worktree.
3. The controlling agent calls Crew `plan` with the exact `prd` path and absolute `workspace` path.
4. Crew resolves the workspace identity and verifies that the controlling session is operating from it.
5. Crew verifies that the plan file is inside that workspace.
6. Crew stores the plan path and canonical workspace identity.
7. Crew verifies the identity, then launches the planner in the canonical workspace.
8. Crew converts the planner response into tasks.
9. Before every later child launch or lobby assignment, Crew verifies the same stored identity again.
10. Each child starts in the canonical worktree and receives the workspace environment variable and system guidance.

## Failure Handling

- A missing or invalid plan path returns the existing `prd_not_found` error and creates no tasks.
- An omitted `workspace` during a Superpowers handoff violates the controlling-agent policy; policy tests must prevent regression in that instruction.
- A nonexistent, non-Git, main-checkout, submodule, or mismatched workspace fails planning before the planner starts or tasks are created.
- A plan outside the workspace fails planning before its contents are sent to a child.
- A workspace mismatch found during later work or review prevents child launch. Pending tasks remain pending. A task must not be left `in_progress` merely because workspace validation failed.
- A lobby worker with a different or unverifiable identity is ineligible for assignment.
- Crew must not fall back to PRD auto-discovery, another checkout, or another worktree after explicit handoff validation fails.
- Error messages must show the expected canonical workspace and the observed directory when available, without exposing unrelated environment data.

## Testing

### Controlling-agent policy tests

- The injected policy requires passing the exact implementation-plan path through `prd`.
- The policy forbids a bare Crew `plan` call for the Superpowers handoff.
- The policy forbids replacing the implementation plan with a summary.
- The policy requires entering the worktree before Crew planning.
- The policy requires the absolute worktree path through `workspace`.
- Existing inactive-state, child-agent, and idempotency behavior remains unchanged.

### Workspace identity unit tests

- Resolve a valid linked worktree into canonical root, Git directory, and common Git directory.
- Reject the main checkout.
- Reject a non-Git directory.
- Reject a submodule as a linked worktree.
- Reject a supplied workspace that differs from the controlling `cwd`.
- Treat symlink aliases as the same workspace after canonicalization.
- Reject a different linked worktree of the same repository.
- Reject a plan path or plan symlink that escapes the workspace.

### Crew planning integration tests

- Create a temporary linked worktree with a distinctive plan under `docs/superpowers/plans/`.
- Invoke Crew planning from that worktree with its exact `prd` and absolute `workspace` paths.
- Capture the planner launch and verify its `cwd`, `PI_CREW_WORKSPACE_ROOT`, source plan path, and distinctive plan content.
- Verify stored plan metadata retains the exact plan source and canonical workspace identity.
- Verify an invalid workspace launches no planner and creates no tasks.

### Child-launch and lobby tests

- Verify fresh workers, reviewers, revision planners, and plan-sync analysts launch with the stored canonical `cwd`, environment variable, and workspace guidance.
- Verify a changed or mismatched workspace blocks launch without leaving a task in progress.
- Verify lobby workers accept only assignments with an identical workspace identity.
- Verify all child launch paths use the shared workspace verifier rather than separate path-comparison rules.

## Non-Goals

- Do not modify stock Superpowers skill files.
- Do not scan `docs/superpowers/plans/` or select a plan by timestamp.
- Do not add a `plan.from-superpowers` action or another plan-source parameter.
- Do not make Crew create, enter, switch, or remove Git worktrees.
- Do not change ordinary Crew PRD discovery or require a linked worktree when no explicit `workspace` handoff is supplied.
- Do not use branch names or commit hashes as durable worktree identity.
- Do not alter Crew task parsing, scheduling, review criteria, or implementation behavior beyond workspace validation and guidance.

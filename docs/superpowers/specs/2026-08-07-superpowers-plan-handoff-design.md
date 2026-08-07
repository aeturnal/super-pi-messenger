# Deterministic Superpowers Plan Handoff Design

## Goal

Ensure that when Superpowers `subagent-driven-development` delegates execution to Crew, the Crew planner receives the exact implementation plan written by the Superpowers `writing-plans` workflow.

## Current Problem

Superpowers writes implementation plans under `docs/superpowers/plans/`. Crew's bare `plan` action does not search that directory. It auto-discovers only fixed names such as `PRD.md`, `SPEC.md`, `DESIGN.md`, and `PLAN.md` in selected locations.

The controlling-agent compatibility policy currently says to translate the Superpowers workflow into Crew planning and work, but it does not state how to carry the implementation plan into Crew. A controlling agent can therefore call a bare Crew `plan` action or pass a summary. In either case, the Crew planner may not receive the approved implementation plan.

## Design

Strengthen the packaged controlling-agent policy in `crew/superpowers-policy.ts` with an explicit handoff contract:

1. When `writing-plans` has produced an implementation plan and `subagent-driven-development` selects Crew, the controlling agent must retain the exact plan path reported by `writing-plans`.
2. The controlling agent must start Crew planning with that exact path in the existing `prd` field:

   ```ts
   pi_messenger({
     action: "plan",
     prd: "docs/superpowers/plans/<exact-plan-file>.md"
   })
   ```

3. For this handoff, the controlling agent must not call a bare `pi_messenger({ action: "plan" })` and must not replace the plan with an inline summary.
4. Crew continues to validate that the supplied file exists, read its contents, place those contents in the planner prompt, and retain the source path in plan metadata.

The existing `prd` parameter remains the single interface for file-backed planning input. No new Crew action or parameter is needed.

## Data Flow

1. `writing-plans` saves the implementation plan and reports its exact path to the controlling agent.
2. The user chooses subagent-driven execution, causing `subagent-driven-development` to apply.
3. The packaged Superpowers compatibility policy directs the controlling agent to invoke Crew with `action: "plan"` and `prd: <exact path>`.
4. `crew/handlers/plan.ts` resolves and reads that file.
5. `buildFirstPassPrompt()` embeds the file contents and path in the Crew planner request.
6. Crew stores the same path in its plan metadata and converts the planner response into Crew tasks.

## Failure Handling

- If the controlling agent supplies a missing or invalid path, Crew returns its existing `prd_not_found` error and creates no tasks.
- Crew must not fall back to auto-discovery after an explicit path fails. Silent fallback could execute work from the wrong specification.
- If no Superpowers implementation plan exists, this handoff rule does not apply. Existing prompt-based and PRD-based Crew planning remain unchanged.

## Testing

Add focused regression coverage for both halves of the contract:

1. **Controlling-agent policy tests**
   - The injected policy requires passing the exact implementation-plan path through `prd`.
   - The policy forbids a bare Crew `plan` call for the Superpowers handoff.
   - The policy forbids replacing the implementation plan with a summary.
   - Existing inactive-state, child-agent, and idempotency behavior remains unchanged.

2. **Crew planning integration test**
   - Create a temporary plan at a representative `docs/superpowers/plans/...` path.
   - Invoke Crew planning with that exact path as `prd`.
   - Capture the spawned planner prompt and verify it contains both the exact source path and distinctive plan content.
   - Verify Crew's stored plan metadata retains the exact source path.

## Non-Goals

- Do not modify stock Superpowers skill files.
- Do not scan `docs/superpowers/plans/` or select a plan by timestamp.
- Do not add a `plan.from-superpowers` action or another plan-source parameter.
- Do not change ordinary Crew PRD discovery.
- Do not alter Crew task parsing, scheduling, review, or worker behavior.

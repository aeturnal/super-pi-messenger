# Product Requirements Document: Super Pi Messenger

**Product name:** Super Pi Messenger
**Repository:** Focused fork of `nicobailon/pi-messenger`  
**Date:** 2026-07-27  
**Revised:** 2026-07-29
**Status:** Revised for Integration MVP review
**Primary optimization target:** Deliver a coherent, thin integration first; keep broader Crew improvements evidence-gated

### How to read this PRD

This document is the long-term product vision and requirements catalog. A requirement is not automatically a prerequisite for the first usable integration. The rollout section identifies which requirements are active in each delivery milestone; requirements assigned to later roadmap themes must not be implemented early as speculative foundations.

The first active delivery target is the concrete Superpowers Integration MVP. It preserves native pi-messenger execution semantics except for a narrowly scoped, independently tested defect that directly blocks MVP acceptance or creates an immediate safety problem. Broader execution, review, repair, recovery, observability, context, routing, and provider-platform work remains evidence-gated roadmap scope.

## 1. Product Summary

Super Pi Messenger is an independently maintained, focused fork of `nicobailon/pi-messenger` that combines pi-messenger's multi-agent execution machinery with engineering methodologies supplied by the separately installed stock Obra Superpowers package. Super Pi Messenger is not affiliated with or endorsed by Obra.

The product will preserve pi-messenger's defining capabilities:

- Multiple specialized agents
- Parallel dependency-aware work
- File reservations
- Agent messaging and presence
- Task state and progress tracking
- Automated planning and review
- Autonomous execution
- Crew overlay and activity feed

The first release will add:

- A thin, concrete, dynamically loaded Superpowers adapter
- Compact role-specific Superpowers guidance for existing Crew agents
- Explicit Crew ownership invariants and nested-orchestration prevention
- Safe native fallback when Superpowers is absent or required skills cannot be resolved
- Minimal inspectability for selected skills, paths, reasons, and prohibited workflows
- Focused rendering and representative live acceptance tests

The long-term roadmap may later add, when evidence justifies each milestone:

- Exact task-owned review diffs and integration review
- Scoped repair and re-review workflows
- Focused execution-correctness and recovery improvements
- Failure classification and bounded retries
- Reduced duplicated context and work
- Structured routine status and bounded diagnostic artifacts
- A generic policy-provider interface if a second provider or demonstrated duplication warrants extraction

Superpowers will remain a separate stock installation and source of truth for its skills. The fork will not copy or rewrite Superpowers skill bodies.

Token accounting, cost dashboards, and usage thresholds are not part of the initial product. Existing provider usage metadata may be recorded by maintainers during development evals, but it will not be a user-facing subsystem or affect agent behavior.

## 2. Problem Statement

Pi-messenger and Superpowers solve complementary problems but do not currently integrate deeply.

Pi-messenger provides a strong multi-agent runtime, but current Crew behavior can consume excessive tokens and credits because it launches many independent sessions, repeats context, reviews overlapping changes, restarts entire tasks after minor feedback, and uses broad coordination prompts.

Superpowers provides disciplined planning, TDD, debugging, verification, and review workflows, but it does not provide pi-messenger's persistent multi-agent task room, dependency scheduler, messaging, reservations, presence, or Crew UI.

The existing local Crew–Superpowers adapter establishes the correct ownership boundary but hardcodes the current Superpowers skill catalog and adds a large role matrix to every Crew agent. The first product step is to replace that broad prompt overlay with compact, dynamically resolved, role-specific guidance. Altering Crew's review, repair, retry, scheduling, or diff behavior is not a prerequisite for proving this integration.

Users therefore face an unsatisfactory choice:

1. Use Superpowers alone for strong discipline but limited parallel Crew orchestration.
2. Use pi-messenger alone for parallel autonomy but accept avoidable cost and weaker methodology enforcement.
3. Stack both systems naively and risk nested orchestration, duplicate planning, duplicate review, and even higher token usage.

The product must combine the complementary strengths without nesting or duplicating the two orchestration models.

## 3. Product Vision

> Pi-messenger is the execution engine for Crew. Superpowers supplies engineering discipline. An always-active compatibility layer ensures that the two installed add-ons behave as one coherent system rather than competing orchestrators.

Whenever pi-messenger and Superpowers are installed together, the integration layer must continuously establish clear ownership without requiring the user to select a mode. When Crew is invoked, pi-messenger owns planning, agent dispatch, dependencies, messaging, task state, review lifecycle, and autonomous execution. Superpowers supplies the relevant engineering practices without launching its own nested orchestration.

Outside a Crew run, Superpowers may guide the normal interactive development workflow. Pi-messenger's messaging, presence, and reservation tools remain available, but it must not inject competing Crew orchestration unless the user invokes Crew. The integration layer is therefore a required compatibility foundation for the two installed add-ons, not an optional hybrid mode.

## 4. Target Users

### 4.1 Primary user

A developer who:

- Uses Pi as a coding harness
- Works on repositories with several parallelizable workstreams
- Wants autonomous multi-agent execution
- Values TDD, debugging discipline, verification, and independent review
- Wants less duplicated work and context without sacrificing completion or quality
- Is willing to use a more complex workflow when the project benefits from it

### 4.2 Secondary users

- Teams using Pi agents in a shared repository
- Maintainers who want pluggable engineering policies
- Researchers evaluating multi-agent development workflows

## 5. Product Principles

### P1. One owner per responsibility

- Pi-messenger owns task decomposition, scheduling, task state, reservations, communication, process lifecycle, review dispatch, and completion state.
- The concrete Superpowers adapter owns engineering-method guidance and role-specific quality standards for the MVP; any future provider boundary must preserve the same ownership.
- The user or outer session owns final integration decisions unless explicitly delegated.

### P2. No adapter-induced nested orchestration

For the Integration MVP, the adapter must not select, recommend, or inject instructions for SDD, plan execution, parallel worker dispatch, nested worktrees, or branch-finishing workflows into ordinary Crew agents. User-authorized nested workflows and stronger runtime enforcement are deferred unless acceptance evidence requires them.

### P3. Eliminate duplication before eliminating judgment

Efficiency improvements should first remove repeated context, repeated diffs, repeated exploration, and repeated implementation attempts. They must not remove necessary review or force tasks onto inadequate models.

### P4. Review the correct scope

Task review must examine task-owned changes. Cross-task integration must be reviewed separately and intentionally.

### P5. Prefer deterministic controller logic

Scheduling, ownership, diff construction, retry classification, schema validation, and Markdown rendering should not consume LLM turns when they can be implemented deterministically.

### P6. Bound failure loops without limiting legitimate work

Retries, repairs, reviews, waves, and artifacts require safeguards against pathological loops or unbounded storage. These safeguards must not prevent a worker or reviewer from completing legitimate assigned work.

### P7. External methodologies remain external

The product may discover and use installed policy content, but it must not vendor or silently modify external skill bodies.

### P8. Complexity is opt-in

Small and tightly coupled tasks should not be forced through a large multi-agent workflow.

## 6. Goals

### G1. Preserve pi-messenger's original intent

Maintain its identity as a file-based multi-agent coordination and Crew orchestration extension.

### G2. Support an update-safe Superpowers integration

Allow existing Crew roles to use the separately installed stock Superpowers methodology through one concrete adapter. Resolve actual installed skills and paths, preserve native fallback, and avoid interfaces that would prevent later extraction if a second provider is approved. A generic provider platform is not initial scope.

### G3. Reduce duplicated work and context

Reduce duplicated prompts, project discovery, review input, retry work, and routine coordination overhead.

### G4. Improve review correctness

Ensure each reviewer receives the correct task-owned diff and evidence, followed by explicit integration review.

### G5. Improve repair efficiency

Use focused repair attempts and scoped re-review for actionable findings rather than restarting complete tasks.

### G6. Improve autonomous reliability

Classify failures, stop deterministic retry loops, preserve recoverable state, and allow legitimate work to finish.

### G7. Keep the independent fork maintainable

Organize changes into clear, tested modules so the fork can be maintained without depending on upstream acceptance or activity.

## 7. Non-Goals

The Integration MVP will not:

- Fork or modify Superpowers.
- Copy Superpowers `SKILL.md` files or prompt templates into this repository.
- Replace Pi's native skill discovery.
- Execute Superpowers SDD recursively inside Crew workers.
- Build a new multi-agent runtime from scratch.
- Replace pi-messenger's overlay, presence, messaging, or reservation systems.
- Force users to invoke Crew for tasks that do not benefit from Crew orchestration.
- Guarantee that parallel Crew uses fewer total tokens than a single-agent workflow.
- Optimize solely for the lowest possible model price.
- Reduce implementation, testing, verification, or review quality merely to reduce model usage.
- Automatically merge, push, create pull requests, delete branches, or clean worktrees without explicit authorization.
- Treat free-form worker chat as a substitute for deterministic scheduling and dependency tracking.
- Rewrite Crew scheduling, controller ownership, attempts, completion, review, repair, cancellation, restart recovery, artifacts, overlay behavior, model routing, or planning as an integration prerequisite.
- Add a generic policy-provider registry before a second provider or concrete duplicated boundary requires one.
- Add dormant schemas or lifecycle machinery whose consuming behavior is deferred to a later milestone.

## 8. Success Definition

### 8.1 Integration MVP success

The first release succeeds when:

1. Existing Crew workers and reviewers receive compact, relevant guidance from the separately installed stock Superpowers package.
2. Workers and reviewers receive only their intended starting guidance.
3. The adapter does not select, recommend, or inject nested-orchestration workflows into ordinary Crew agents.
4. Superpowers absence leaves native pi-messenger behavior unchanged.
5. Missing required resources produce an actionable warning and complete native fallback.
6. Selected skills, resolved paths, reasons, and prohibited workflows are minimally inspectable.
7. Existing pi-messenger tests remain green and no broad execution subsystem is rewritten as a prerequisite.

### 8.2 Long-term product success

After the MVP is operating, later evidence-driven releases may additionally demonstrate:

- Faster suitable parallel work than a comparable sequential workflow
- Fewer avoidable retries and less duplicated context
- Correct task and integration review scope
- Efficient bounded repair
- Improved failure handling and recoverability
- Bounded memory and artifact growth
- Continued important-defect detection
- Maintainable compatibility with external Superpowers updates

## 9. Runtime Ownership

When pi-messenger and Superpowers are installed together, the compatibility layer activates automatically. The user does not select between builtin, Superpowers, or hybrid modes.

During a Crew run, pi-messenger owns orchestration and Superpowers supplies relevant engineering discipline. Outside Crew, Superpowers may guide the interactive workflow while pi-messenger's messaging, presence, and reservation tools remain available without injecting competing orchestration.

If Superpowers is not installed, the compatibility layer remains inactive and pi-messenger behaves exactly as it normally would. If Superpowers appears installed but the MVP cannot resolve its required skills safely, the adapter must emit one actionable warning and apply no integration policy. Configurable compatibility modes may be added later if real version differences require them. The adapter must never silently allow both systems to issue conflicting orchestration instructions.

## 10. System Architecture

### 10.1 Existing Crew execution engine

For the Integration MVP, pi-messenger's existing Crew engine remains authoritative and behaviorally unchanged except for a focused blocker fix approved under the MVP acceptance criteria. It continues to own:

- Agent spawning and existing role/task metadata
- Task graph and wave scheduling
- Task state and worker ownership
- File reservations
- Agent messaging and progress tracking
- Existing review, retry, cancellation, overlay, and process behavior

The MVP must not introduce a second task authority or require a replacement scheduler, lease, attempt, review, repair, or recovery subsystem.

### 10.2 Concrete Superpowers adapter

One concrete adapter discovers and selects guidance from the separately installed stock Superpowers package. Clean private functions are encouraged, but a public generic provider API and registry are deferred until a second provider is approved or concrete duplication demonstrates a stable shared boundary.

The adapter must:

- Discover the installed Superpowers package through Pi resource metadata or configured package paths.
- Detect the installed version when available.
- Use actual installed skill names, descriptions, and paths.
- Select only the skills relevant to the current supported Crew role and existing assignment context.
- Preserve Crew ownership of orchestration.
- Not select, recommend, or inject nested controllers, nested worktrees, or unauthorized integration actions into ordinary Crew agents.
- Warn and fall back completely when a known-incompatible installation or missing required skill makes safe guidance impossible.
- Remain inactive when Superpowers is unavailable so native pi-messenger behavior is unchanged.

The adapter must not:

- Copy skill contents into this repository.
- Maintain a hardcoded claim that a fixed number of skills are installed.
- Invoke `using-superpowers` as a complete workflow inside dispatched Crew agents.
- Inject the full Superpowers skill matrix into every role.

### 10.3 Per-launch policy selection record

Before launching a supported Crew agent, the adapter must create a compact inspectable selection record that records:

- The agent's existing Crew role and assignment identifier or context when available
- The detected Superpowers version
- The required starting skills selected for the agent
- The installed paths used for those skills
- A short reason each skill was selected
- Any orchestration workflows explicitly prohibited for that agent

The selection record must be inspectable in tests and minimal Crew status without storing the complete system prompt. Durable persistence is not required for MVP unless implementation evidence shows post-launch inspection cannot otherwise be supported. Required starting guidance must not prevent the agent from discovering and using other relevant installed skills.

### 10.4 Role and ownership input

The adapter should use reliable role/task metadata already available at the existing common launch boundary. It may add explicit bounded metadata when the existing launcher supports it without redesign, but an execution-metadata migration is not an MVP prerequisite. A possible later contract is:

```text
PI_CREW_ROLE=planner|worker|reviewer|analyst|integration-reviewer
PI_CREW_TASK_ID=<task-id when applicable>
PI_CREW_ATTEMPT_KIND=initial|repair|replan|review|rereview|integration
PI_CREW_POLICY_PROVIDER=superpowers
```

Additional metadata may be added later if it is stable, bounded, useful, and justified by delivered behavior.

### 10.5 Conditional future provider extraction

If a second provider is approved or the concrete Superpowers adapter reveals stable duplicated boundaries, a separate design may extract a generic provider interface. That future extraction must preserve native fallback and isolate provider failures from Crew task state; it is not part of the Integration MVP.

## 11. Functional Requirements

The requirements below remain the long-term catalog. The active Integration MVP requirements are FR-POL-001 through FR-POL-007 as qualified below; FR-SKL-001, FR-SKL-004, and FR-SKL-006 through FR-SKL-010 as qualified below; minimal status behavior from FR-UI-001; and applicable quality/safety requirements. Specialized bug, repair, and planner guidance in FR-SKL-002, FR-SKL-003, and FR-SKL-005 is deferred. Other requirements remain deferred until a rollout milestone explicitly activates them. Deferred requirements must not be implemented early solely to establish speculative foundations.

## 11.1 Policy discovery and compatibility

### FR-POL-001

When pi-messenger and Superpowers are both installed, the compatibility layer must activate automatically without requiring the user to select a policy mode.

### FR-POL-002

The Superpowers adapter must discover currently loaded Superpowers skills dynamically rather than relying only on a hardcoded catalog.

### FR-POL-003

The adapter must distinguish known lifecycle-critical skills from unknown newly installed skills.

### FR-POL-004

Unknown skills must remain discoverable but must not automatically gain orchestration permissions.

### FR-POL-005

The adapter must expose active, inactive, or fallback status, the detected Superpowers version when readily available, and an actionable fallback reason in minimal Crew status output.

### FR-POL-006

Configurable compatibility modes are deferred. For the Integration MVP, unresolved required resources or a known incompatible installation must produce an actionable warning and complete native fallback; partial policy injection is forbidden.

### FR-POL-007

If Superpowers is unavailable, the compatibility layer must remain inactive and pi-messenger must continue with its normal native behavior. A status indicator may report that integration is inactive, but Crew must not warn, block, or behave as if this were an error.

## 11.2 Role- and phase-specific skill selection

### FR-SKL-001

An existing Crew worker should receive TDD and verification guidance.

### FR-SKL-002

Deferred beyond the Integration MVP: a deterministically classified bug or failing-test worker should receive systematic-debugging, TDD, and verification guidance.

### FR-SKL-003

Deferred beyond the Integration MVP: a deterministically classified review repair worker should receive receiving-code-review, relevant implementation discipline, and verification guidance.

### FR-SKL-004

An existing Crew reviewer should receive review rubric and evidence-validation guidance without being instructed to dispatch another reviewer.

### FR-SKL-005

Deferred beyond the Integration MVP: planner integration should adapt planning and decomposition principles without blindly loading a complete workflow that starts a second human approval loop, plan executor, or competing controller inside autonomous Crew planning.

### FR-SKL-006

For the Integration MVP, the adapter must not select, recommend, or inject SDD, executing-plans, parallel-dispatch, nested-worktree, or branch-finishing workflows into ordinary Crew roles.

### FR-SKL-007

The generated policy prompt must include only applicable skills and compact shared invariants.

### FR-SKL-008

Before launch, every supported MVP Crew role must have an inspectable per-launch selection record showing its selected Superpowers skills, resolved paths, short reasons, and prohibited workflows. Durable manifest persistence is deferred unless evidence requires it.

### FR-SKL-009

The adapter must validate that every required selected skill exists at the discovered installed path. Missing required skills must produce an actionable compatibility warning and complete native fallback rather than silently launching with incomplete guidance.

### FR-SKL-010

The required starting skills in the manifest must not prevent an agent from discovering and using additional relevant installed skills.

## 11.3 Task specification and context

### FR-CTX-001

A fresh worker must receive one canonical current task specification.

### FR-CTX-002

The assignment must include a task-spec version or content hash.

### FR-CTX-003

Workers must reread the task spec only when:

- The version differs
- The task is resumed
- The task is a retry or repair
- The assignment is manual
- Required information is missing

### FR-CTX-004

The system should provide a compact commit-keyed repository manifest containing stable project orientation such as source roots, test commands, and key configuration files.

### FR-CTX-005

Workers must still inspect task-relevant source files directly; the manifest is not authoritative code context.

### FR-CTX-006

Only recommended skills should include full names, descriptions, and paths. Other skills should be discoverable through a compact index or query mechanism.

## 11.4 Planning

### FR-PLN-001

Planner output must use one canonical structured plan representation.

### FR-PLN-002

Human-readable Markdown must be generated deterministically from the structured plan where practical.

### FR-PLN-003

The structured plan must include:

- Summary
- Gaps and assumptions
- Global constraints
- Tasks
- Acceptance criteria
- Dependencies
- Expected files or interfaces when known
- Risk classification
- Recommended skills

### FR-PLN-004

The controller must validate plan schema, task IDs, missing dependencies, cycles, and transitive dependency redundancy without an LLM.

### FR-PLN-005

Planning review/refinement must be adaptive. It should run for high-risk, ambiguous, invalid, or explicitly requested plans rather than uniformly requiring multiple passes.

### FR-PLN-006

A `SHIP` plan-review verdict must end refinement immediately.

### FR-PLN-007

Refinement prompts must use the canonical prior plan and structured findings rather than an unbounded accumulated prose history.

## 11.5 Task-owned change tracking

### FR-GIT-001

The system must record each task's starting commit.

### FR-GIT-002

`task.done` must record task-owned commit SHAs, final commit, changed files, and test evidence.

### FR-GIT-003

The system must validate that recorded commits exist and are reachable from the current work state.

### FR-GIT-004

Task review must use only task-owned changes or an equivalent validated task patch.

### FR-GIT-005

When task ownership cannot be determined safely, review must stop with an actionable error rather than silently reviewing the entire wave as if it belonged to one task.

### FR-GIT-006

Shared-file or overlapping-commit cases must be surfaced for integration review.

## 11.6 Task review

### FR-REV-001

Every completed implementation task must receive review unless the user explicitly disables review.

### FR-REV-002

A review package must contain:

- Task specification
- Global constraints relevant to the task
- Task-owned commit list
- Diff stat
- Exact task diff
- Worker summary
- Test evidence
- Reported concerns

### FR-REV-003

Reviewers must issue structured verdicts:

- `SHIP`: the task satisfies its requirements and the underlying approach is sound.
- `NEEDS_WORK`: the core approach, architecture, important assumptions, and public interfaces remain valid, but localized implementation or test findings must be corrected.
- `MAJOR_RETHINK`: the core approach, architecture, important assumptions, or public interfaces are invalid or uncertain enough that a focused repair would risk patching around a deeper problem.

### FR-REV-004

Review findings must include severity, file/line when available, evidence, and an actionable explanation.

### FR-REV-005

Reviewers must not rerun an unchanged complete test suite by default when valid test evidence is already attached to the reviewed commit.

### FR-REV-006

Reviewers may run additional targeted checks when evidence is missing, stale, inconsistent, or insufficient.

### FR-REV-007

Review model and depth may vary by risk, but review coverage must not be silently skipped solely because a diff is small.

### FR-REV-008

Before returning `NEEDS_WORK`, the reviewer must explicitly confirm that the architecture, core approach, important assumptions, and affected public interfaces remain valid and that every required change is reasonably localized.

### FR-REV-009

If the reviewer cannot confidently make that confirmation, it must return `MAJOR_RETHINK` rather than treating uncertainty as a minor repair.

## 11.7 Integration review

### FR-INT-001

After task-scoped reviews pass, the system must support an explicit wave-level integration review.

### FR-INT-002

Integration review must examine:

- Combined wave changes
- Shared files
- Cross-task interfaces
- Dependency contracts
- Conflicting assumptions
- Integration test evidence

### FR-INT-003

Integration review findings must identify the affected tasks when possible.

### FR-INT-004

The system must support one final branch-level review before declaring the entire plan complete when configured.

### FR-INT-005

Integration review must not replace task-scoped review.

### FR-INT-006

If integration review reveals an invalid cross-task design, interface, dependency contract, or shared assumption, it must return `MAJOR_RETHINK` for the affected work rather than route the problem through a localized repair.

## 11.8 Repair and re-review

### FR-RPR-001

A `NEEDS_WORK` verdict may create a scoped repair attempt only after the reviewer has explicitly confirmed that the core design remains sound and the required changes are localized. It must not automatically restart the complete task.

### FR-RPR-002

The repair package must include:

- Original task specification
- Open findings
- Current implementation summary
- Reviewed commit boundary
- Required targeted tests
- The reviewer's explicit confirmation that the core design remains sound
- The boundaries that make the work eligible for focused repair

### FR-RPR-003

The repair worker must append new commit and test evidence.

### FR-RPR-004

Re-review must examine the repair diff and original findings without replaying the entire task history by default. It must also perform a design sanity check against the original task and relevant architectural constraints to confirm that the repair did not preserve or introduce a deeper design problem.

### FR-RPR-005

One scoped repair should be the default maximum before escalation.

### FR-RPR-006

`MAJOR_RETHINK` must block or trigger explicit re-planning; it must not silently enter the minor repair path.

### FR-RPR-007

A repeated unresolved finding must trigger a configured breaker rather than an unbounded loop.

### FR-RPR-008

A repair worker that discovers the requested changes require redesign, invalidate a public interface, or depend on a false assumption must stop the focused repair and escalate to `MAJOR_RETHINK`.

### FR-RPR-009

If re-review finds that the original issue remains, the repair introduced an architectural problem, or the reviewer can no longer confirm the core approach is sound, the task must escalate to `MAJOR_RETHINK` rather than receive another focused patch.

## 11.9 Failure classification and retries

### FR-ERR-001

The controller must classify failures before retrying.

### FR-ERR-002

When the provider refuses further model calls because of quota or credit exhaustion, the local controller must stop launching and retrying agents and mark the affected work as paused rather than failed or complete.

### FR-ERR-003

Authentication and deterministic configuration failures must block with actionable diagnostics.

### FR-ERR-004

Rate limits with valid retry guidance may wait and retry within a strict configured bound.

### FR-ERR-005

Unknown worker crashes may retry once with recovery context.

### FR-ERR-006

The system must fingerprint repeated failures and stop retries when the same deterministic failure occurs without changed conditions.

### FR-ERR-007

Cancelled work must release reservations and preserve sufficient state for a safe later retry.

### FR-ERR-008

Autonomous state must reconcile tasks after abnormal worker or orchestrator termination whenever possible.

### FR-ERR-009

A provider-forced quota pause must deterministically record all durable recovery information already available without requiring another LLM call. This includes the task and agent identifiers, attempt kind, repository and commit state, unfinished working-tree changes, recorded test or tool output references, and the reason for the pause.

### FR-ERR-010

A quota pause must release process-level reservations safely while retaining ownership information for unfinished files. On recovery, Crew must validate the working tree and reacquire reservations before continuing.

### FR-ERR-011

Recovery may resume a supported saved session or launch a recovery worker with the original task and durable state. The system must not claim to preserve reasoning or information that never left the interrupted model.

## 11.10 Coordination

### FR-CRD-001

File reservation enforcement must remain enabled independently of coordination verbosity.

### FR-CRD-002

Routine lifecycle status should use structured events, while agents remain free to communicate whenever they judge that doing so would help the work, coordination, or quality.

### FR-CRD-003

Workers should be notified when:

- File reservations conflict
- Tasks share declared interfaces
- A dependency interface changes
- A concrete blocking question is sent

### FR-CRD-004

Routine task start and completion announcements should use deterministic feed events rather than LLM-authored broadcasts by default.

### FR-CRD-005

Agents and users must be able to send DMs and broadcasts whenever they believe communication would be useful.

### FR-CRD-006

Direct messages must be delivered promptly. Relevant broadcasts and shared discoveries must remain available to other agents, which may respond or act using their own judgment.

### FR-CRD-007

The orchestrator, not completed workers, should normally schedule the next task. This does not restrict workers from suggesting follow-up work or communicating useful findings.

### FR-CRD-008

The system should discourage repetitive automated status chatter, but it must not impose message quotas that prevent useful agent communication.

## 11.11 Diagnostic artifacts

### FR-ART-001

Raw artifacts must be disabled by default or use compact mode by default.

### FR-ART-002

The recorder must not persist full accumulated `message_update` snapshots for every token delta.

### FR-ART-003

Compact mode should retain final messages, tool events, input reference, final output, errors, and metadata without quadratic growth.

### FR-ART-004

Diagnostic artifacts must have configurable per-run and total byte caps. These caps must not silently discard complete raw tool or test output that an active worker or reviewer may still need.

### FR-ART-005

`cleanupDays` or equivalent retention must be implemented and tested. Cleanup may remove eligible output only after the related work and review are complete and the retention period has elapsed.

### FR-ART-006

Completed raw artifacts should be rotated or compressed when explicitly enabled.

### FR-ART-007

Artifacts should be stored outside normal repository state by default or automatically excluded from version control and broad tool scans.

### FR-ART-008

The parent orchestrator must not retain every accumulated streaming snapshot in memory.

## 11.12 Complete tool and test output access

### FR-OUT-001

Complete, unmodified tool and test output must remain available while the related task and review are active.

### FR-OUT-002

If output is too large to place into an agent's context at once, the displayed portion must be clearly marked as incomplete and provide a path or identifier for the complete raw output.

### FR-OUT-003

Agents and reviewers must be able to read, search, or retrieve the complete raw output in chunks without relying on a generated summary.

### FR-OUT-004

A summary must never replace or overwrite the original output. No system may silently decide that omitted lines are unimportant.

### FR-OUT-005

Test evidence may present the command, commit, exit status, counts, duration, and warnings for quick review, but it must also reference the complete unmodified log whenever the command produced additional output.

### FR-OUT-006

Complete output may be compressed or removed only after the related implementation and review are complete and the configured retention period has elapsed.

### FR-OUT-007

Targeted tests should be preferred during task work and repair, with broader suites at integration boundaries. This test-selection strategy must not alter or discard the output of commands that are run.

## 11.13 User interface and status

### FR-UI-001

For the Integration MVP, Crew status must display whether the concrete Superpowers adapter is active, inactive, or in native fallback, with selected skills/reasons when active and an actionable reason when fallback occurs. Generic provider status is deferred.

### FR-UI-002

Task detail must show:

- Attempt kind
- Owned commits
- Review count
- Repair count
- Risk
- Assigned Superpowers starting skills and selection reasons

### FR-UI-003

The overlay must distinguish task review from integration review.

### FR-UI-004

The user must be able to pause autonomous work before the next agent launch.

### FR-UI-005

Unsupported policy versions, suppressed retries, and provider-forced pauses must be visible and actionable. A paused task must explain that durable work was preserved and how it can be resumed.

### FR-UI-006

The activity feed must use compact deterministic events for routine policy, review, repair, and integration transitions while preserving free-form agent communication.

## 12. Configuration Requirements

The Integration MVP should require no new user configuration when supported Superpowers resources are available. Absence remains silently native; incomplete or known-incompatible resources produce an actionable warning and complete native fallback. Configurable compatibility modes and the broader representative configuration below are deferred roadmap requirements.

A representative future configuration may look like:

```json
{
  "crew": {
    "integration": {
      "superpowersCompatibility": "warn"
    },
    "coordination": "structured-flexible",
    "review": {
      "enabled": true,
      "mode": "risk-based",
      "maxRepairs": 1,
      "integrationReview": true,
      "finalReview": true
    },
    "artifacts": {
      "mode": "off",
      "maxBytesPerRun": 10485760,
      "cleanupDays": 7
    }
  }
}
```

Exact names and defaults may change during design, but configuration must remain:

- Backward-compatible where practical
- Layered through existing user/project precedence
- Validated with actionable errors
- Documented with defaults
- Safe when partially specified

## 13. Quality and Safety Requirements

### QR-001

Every behavioral change must be developed with automated tests.

### QR-002

Lifecycle state transitions must have deterministic unit tests.

### QR-003

Agent prompt behavior must have both rendering tests and live acceptance tests with supported models.

### QR-004

The Integration MVP regression set must cover:

- Nested orchestration prevention
- Dynamic installed-skill discovery
- Per-launch skill selection, path validation, reasons, and prohibited workflows
- Complete native fallback
- Role-specific compact prompt rendering
- Preservation of existing project agent overrides and native launch behavior

Later activated milestones must add regression tests for:

- Explicit role metadata when introduced
- Exact task review ranges
- Parallel task commit ownership
- Scoped-repair eligibility, repair-worker escalation, and design-aware re-review
- Failure classification
- Quota retry suppression, durable paused-state capture, reservation recovery, and later resumption
- Confirmation that interrupted model reasoning is not represented as saved state
- Useful agent communication alongside structured status events
- Complete raw-output access when displayed output is truncated
- Artifact size bounds that preserve active task and review evidence
- Cleanup retention
- Crash reconciliation

### QR-005

No test may claim compatibility with the current installed Superpowers catalog by comparing two hardcoded copies of the same catalog.

### QR-006

Superpowers adapter failures must not corrupt Crew task state or leave partially applied policy. The same requirement applies to any future extracted provider boundary.

### QR-007

Project-local policy code or configuration must obey Pi project trust rules.

### QR-008

Extensions and the concrete Superpowers adapter must be treated as trusted executable code and documented accordingly. The same rule applies to any future policy provider.

## 14. Initial Eval Requirements

The Integration MVP must use focused rendering tests plus a minimal live acceptance set rather than building a general-purpose benchmark platform:

1. One representative Crew worker can access and follow its selected installed methodology.
2. One representative dispatched Crew agent does not start nested orchestration.
3. Native behavior remains unchanged when Superpowers is absent.

The existing long-term eval definitions remain valuable roadmap fixtures:

1. Several independent tasks that can run in parallel
2. Parallel tasks that share an exported interface
3. A review returning `NEEDS_WORK` followed by scoped repair and re-review

Each activated eval must have a resettable repository fixture, a defined task, known acceptance checks, and a simple results record. Build and baseline a fixture only when its related behavior is active; do not require review/repair fixtures to block the Integration MVP. The integrated fork should be evaluated directly and compared with stock pi-messenger where the comparison answers a current milestone question. A stock Superpowers-only run may be recorded as a useful reference, but it is not required for every eval or release gate.

Initial eval results should record:

- Whether the requested work and automated checks pass
- Important findings and escaped defects
- Correct task-review and integration-review scope when that roadmap behavior is under evaluation
- Whether scoped repair resolves the original finding when repair is under evaluation
- Unexpected nested orchestration
- Agent sessions, retries, review cycles, human interventions, and wall-clock duration
- Existing provider usage metadata when readily available

The eval tooling should remain simple: small fixtures, reset scripts, acceptance checks, and a Markdown or structured results file. It must not become a product telemetry system or a separate benchmark platform.

When their roadmap milestones activate, provider failures, quota handling, large output access, worker crashes, and orchestrator recovery must be covered primarily by deterministic unit and integration tests. They may become model evals later if real failures show that deterministic tests are insufficient.

## 15. Rollout Plan

The numbered phases below identify the active delivery sequence; later sections labeled as future roadmap themes are not active implementation commitments. Milestones are independently planned and reviewed delivery units. Each milestone must leave the repository safe, working, migrated, and independently testable; no milestone may rely on unfinished later work to remain safe. Each active milestone receives its own implementation plan and a separate design when architectural decisions remain.

The existing Phase 1A and Phase 1B execution designs are preserved as design research, not active implementation contracts. Their experimental branch remains unmerged by default. Before that worktree is modified or removed, preserve unfinished Task 4 work as an explicitly labeled WIP commit or patch. Restarting work derived from those designs requires a new evidence-based scope decision and explicit design approval.

A milestone must be rescoping-reviewed before implementation when it has more than one operational outcome, introduces more than one durable lifecycle state, combines persistence/migration/provider invocation/recovery, touches substantially more than 1–4 production files, or is expected to exceed roughly 200–400 production lines. These are review triggers rather than rigid limits. Implementation-plan tasks should carry one focused RED/GREEN cycle, one coherent reviewer gate, and one commit.

## Phase 0: Baseline and fork hygiene

- Create the independently maintained fork and configure `origin` for it.
- Preserve pi-messenger's history and keep a read-only `upstream` remote for monitoring only.
- Define all three eval tasks and their acceptance checks.
- Implement only the independent-parallel-task smoke eval, with a minimal reset script and results template.
- Record its stock pi-messenger baseline.
- Document how upstream activity will be monitored and how useful changes can be evaluated and imported selectively.

### Exit criteria

- Fork builds and passes the inherited pi-messenger test suite.
- All three eval definitions are fixed before related feature implementation begins.
- The independent-parallel-task smoke eval and stock baseline are usable.
- No Superpowers content is copied.

## Phase 1: Concrete Superpowers Integration MVP

Phase 1 delivers the motivating integration while preserving native pi-messenger execution behavior. Each milestone is vertical, independently useful, and reviewed before the next begins. A narrowly scoped native-runtime fix is allowed only when a focused failing test proves it blocks MVP acceptance or creates an immediate safety problem.

### Milestone 1.1: Discovery and complete native fallback

- Discover the separately installed stock Superpowers package through Pi-supported resource or command metadata.
- Resolve the small set of required MVP skills by actual installed name and path without copying skill bodies.
- When Superpowers is absent, remain silently inactive and preserve native pi-messenger behavior.
- When Superpowers appears present but required resources cannot be resolved, emit one actionable warning and apply no integration policy.
- Build the complete adapter result before changing a launch prompt so failed activation cannot leave partial policy.

#### Exit criteria

- Supported resources activate the adapter deterministically.
- Superpowers absence leaves existing launch prompts and behavior unchanged.
- Missing required resources produce complete native fallback, not partial guidance.
- Existing pi-messenger tests remain green.

### Milestone 1.2: Worker and reviewer guidance

- Add a concrete role-to-skill mapping for existing Crew workers and reviewers.
- Render compact Crew ownership invariants, selected installed skill references, short selection reasons, and prohibited workflows.
- Give workers TDD and verification guidance.
- Give reviewers evidence-validation guidance without nested reviewer dispatch.
- Do not select, recommend, or inject SDD, executing-plans, parallel-dispatch, nested-worktree, or branch-finishing workflows into ordinary Crew roles.
- Preserve existing task prompts, project agent overrides, launch behavior, task state, review behavior, and scheduling.

#### Exit criteria

- Workers and reviewers receive only their intended starting guidance.
- Rendered guidance is smaller than the existing global role matrix.
- Selected paths come from the installed package rather than hardcoded copies.
- Crew remains the sole orchestration and task authority.

### Milestone 1.3: Inspectability and acceptance

- Expose active, inactive, or fallback status plus selected skills, resolved paths, short reasons, and prohibited workflows through tests and minimal Crew status.
- Keep the selection record per launch; do not add durable manifest persistence unless evidence shows post-launch inspection requires it.
- Add deterministic rendering tests for every supported MVP role.
- Add one representative live worker acceptance check for methodology availability.
- Add one representative live acceptance check that a dispatched Crew agent does not start nested orchestration.
- Verify native behavior with Superpowers absent and actionable complete fallback with required resources missing.

#### Exit criteria

- Focused rendering tests pass for every supported MVP role.
- Representative live acceptance demonstrates useful methodology access and no nested orchestration.
- Native behavior remains unchanged without Superpowers.
- No scheduler, lease, attempt, review, repair, pause, recovery, artifact, planning, or routing redesign was imported unless separately approved as a focused blocker fix.

## Phase 2: Evaluate the delivered integration

Phase 2 gathers evidence before selecting broader Crew work. It does not create a general benchmark or telemetry platform.

- Measure methodology adherence in representative Crew runs.
- Check whether nested orchestration occurs despite the ownership policy.
- Compare prompt size with the prior broad role matrix.
- Verify native fallback and project agent overrides in real use.
- Record concrete execution, review, repair, reliability, or context failures observed during integrated use.
- Rank later work by severity, frequency, user value, and architectural dependency.

### Exit criteria

- The Integration MVP has a reviewed results record.
- Later milestones are prioritized from observed evidence and known independently reproduced defects.
- No broad subsystem rewrite is approved solely because it was described in the long-term requirements catalog.

## Future roadmap theme: Evidence-selected execution correctness, reliability, and observability

This theme preserves known execution requirements without making them prerequisites for integration. Approve only focused milestones justified by Integration MVP evidence or an independently reproduced immediate safety defect.

### Milestone E1: Focused blocker corrections

Known evidenced backlog items include launcher tool-contract inconsistency, ambiguous task-owned Git changes, shared-worktree/index behavior, incorrect review ranges, cross-checkout reservation scoping, and reservation enforcement that cannot cover shell writes. These remain traceable roadmap items, not automatic MVP prerequisites. The required `pi_messenger` tool contract is the clearest candidate for a focused MVP blocker correction if acceptance reproduces it.

- Reproduce one concrete defect with a focused failing test.
- Implement the smallest independently reviewable correction.
- Preserve native execution semantics outside the tested defect.
- Prefer isolated fixes such as the required `pi_messenger` tool contract over importing replacement controller machinery.

### Milestone E2: Execution ownership redesign, if justified

- Create a separate design only if evidence shows multiple defects share the same controller/ownership root cause.
- Split identity, scheduling, attempts, completion, reviews, cancellation, adapters, and migration into separate vertical milestones.
- Do not activate a replacement scheduler until its required durable lifecycle is complete and independently tested.

### Milestone E3: Recovery and failure policy, if justified

- Add pause, recovery, retry suppression, reservation recovery, and crash reconciliation only for approved observed failure classes.
- Deliver each recovery path end to end; do not add inactive pause or recovery schemas as standalone foundations.
- Never claim to preserve private model reasoning that was not durably recorded.

### Milestone E4: Bounded observability

- Address measured parent-memory or artifact-growth defects independently of scheduler replacement.
- Keep artifacts off by default, bounded, and separate from active complete-output access.
- Add retention, permissions, privacy, and stress tests with the behavior they protect.

### Exit criteria

- Every activated milestone cites its evidence and leaves unrelated native behavior unchanged.
- No execution redesign is treated as an integration prerequisite.
- Durable lifecycle additions include their activation, recovery, migration, and focused tests in approved reviewable units.

## Future roadmap theme: Correct review scope

### Milestone 2A: Task-owned change tracking

- Implement the shared-interface eval fixture and record its stock pi-messenger baseline before changing review behavior.
- Track and validate task-owned commits, final commit, changed files, and test evidence.
- Detect overlapping or ambiguous ownership and fail safely instead of guessing review scope.

### Milestone 2B: Task review packages

- Build bounded, reproducible review packages containing the exact task-owned diff and evidence.
- Add structured findings and verdicts with actionable evidence.
- Preserve review coverage while avoiding unrelated wave changes.

### Milestone 2C: Integration and final review

- Add explicit wave-level integration review for shared files, interfaces, and dependency contracts.
- Attribute integration findings to affected tasks when possible.
- Add configurable final branch review without replacing task-scoped review.

### Exit criteria

- Parallel task reviewers do not receive unrelated wave diffs.
- Cross-task interactions remain covered by integration review.
- Review packages are bounded and reproducible.
- The shared-interface eval passes its acceptance checks and has recorded comparative results.

## Future roadmap theme: Repair lifecycle

### Milestone R1: Repair eligibility contract

- Implement the review-repair eval fixture and record its stock pi-messenger baseline before changing repair behavior.
- Define structured findings and the design-validity gate that distinguishes eligible `NEEDS_WORK` from `MAJOR_RETHINK`.
- Define the bounded repair package and required reviewer confirmation.

### Milestone R2: Scoped repair, re-review, and escalation activation

This milestone must deliver an end-to-end usable repair behavior; it must not add dormant repair persistence before activation is ready.

- Add `initial` and `repair` attempt kinds only as part of activating the scoped repair path.
- Persist the bounded repair package and repair-owned evidence consumed by that path.
- Add repair-worker escalation results and consume them in the same milestone.
- Keep activation off until repair-aware re-review and loop breakers are complete, then activate one scoped repair for eligible localized findings.
- Record repair-owned commits and required targeted test evidence.
- Allow the repair worker to escalate deeper problems to `MAJOR_RETHINK`.
- Implement finding-focused re-review with a design sanity check.
- Add repeated-finding breakers and enforce the one-repair default.
- Route invalid designs and failed repairs to explicit re-planning or blocking.

### Exit criteria

- Minor findings do not restart complete tasks.
- Focused repair is used only after the reviewer confirms that the core design remains sound.
- Repair workers and re-reviewers escalate deeper problems instead of patching around them.
- Re-review examines repair-owned changes and performs a design sanity check.
- Review loops are bounded.
- The review-repair eval passes its acceptance checks and has recorded comparative results.

## Conditional future roadmap theme: Generic policy-provider extraction

Do not implement this theme for the Integration MVP. Consider it only after a second provider is approved or the delivered concrete Superpowers adapter demonstrates stable duplicated lifecycle boundaries.

### Milestone P1: Provider boundary extraction

- Extract only interfaces already proven by the concrete adapter.
- Add a provider registry only when more than one provider must be selected.
- Isolate provider failures from Crew task state.
- Preserve complete native fallback when no provider is active.

### Milestone P2: Additional provider acceptance

- Test each approved provider against the same bounded role/policy contract.
- Verify provider selection cannot create competing orchestration authorities.
- Document compatibility and migration only for providers that actually ship.

### Exit criteria

- At least two concrete providers or demonstrated duplication justify the shared API.
- Extraction does not expand the Superpowers prompt or lifecycle scope.
- Native behavior remains unchanged with no active provider.

## Future roadmap theme: Context and planning efficiency

### Milestone 5A: Structured planning

- Add one canonical structured planner output.
- Generate human-readable Markdown deterministically.
- Validate schemas, dependencies, cycles, and redundant transitive dependencies without an LLM.
- Make plan review adaptive and stop refinement immediately on `SHIP`.

### Milestone 5B: Task and repository context

- Add task-spec versioning, hashing, and deduplication.
- Add the commit-keyed repository manifest.
- Ensure workers still inspect task-relevant source directly.

### Milestone 5C: Broader skill and context delivery

- Add specialized bug, repair, and planner guidance only after a deterministic role or assignment classification contract exists.
- Inject full metadata only for recommended skills.
- Preserve a compact index or query path for other discoverable skills.
- Avoid repeating complete skill catalogs in every agent prompt.

### Milestone 5D: Complete output access

- Preserve complete raw tool and test output while related work and review remain active.
- Mark displayed truncation explicitly and provide chunked read/search access to the original output.
- Keep summaries additive and apply retention only after related work and review complete.

### Exit criteria

- Fresh workers receive one current task spec.
- Planner output duplication is reduced.
- Stable project discovery is reused safely.
- Relevant skill paths remain discoverable.
- Large command output remains fully accessible to active workers and reviewers even when it cannot fit into one prompt.

## Future roadmap theme: Routing and coordination

### Milestone 6A: Quality-first routing

- Add quality-first reviewer and model routing without silently skipping review based on diff size.
- Preserve strong review for high-risk paths, public interfaces, and sensitive changes.

### Milestone 6B: Structured status and flexible communication

- Use deterministic structured events for routine lifecycle status.
- Preserve agent judgment about useful direct messages and broadcasts.
- Remove repetitive automated chatter without imposing artificial communication quotas.

### Milestone 6C: Evidence-gated review batching

- Add optional low-risk review batching only after earlier eval evidence supports it.
- Keep batching disabled for work whose risk or interfaces require independent review.

### Exit criteria

- Model selection remains capable of meeting each role's quality requirements.
- Routine status does not create repetitive chatter.
- Agents can communicate useful findings without artificial message limits.
- High-risk work retains strong review.

## Future roadmap theme: Independent packaging and compatibility maintenance

### Milestone 7A: Supported package and installation

- Package the adapter through Pi's supported installation mechanism.
- Preserve the separately installed stock Superpowers dependency and avoid duplicate extension loading.
- Define deterministic installation, migration, and removal behavior.

### Milestone 7B: Compatibility CI and version policy

- Add compatibility CI against supported pinned and current Superpowers releases.
- Document supported Pi and Superpowers version ranges.
- Detect compatibility failures before publishing a supported release.

### Milestone 7C: Independent release and maintenance

- Establish independent versioning, releases, changelog, and support documentation for the fork.
- Monitor pi-messenger upstream without depending on new releases or contribution acceptance.
- Evaluate upstream changes individually and import only those that remain useful and compatible.

### Exit criteria

- The adapter is installable without hand-editing user files.
- The fork can be released, tested, and maintained without upstream participation.
- Fork divergence is documented and organized into clear modules.
- Superpowers compatibility failures are detected before a supported release is published.
- No milestone depends on an upstream pull request being accepted.

## 16. Migration and Backward Compatibility

### Integration MVP

- The MVP must not change task, plan, scheduler, review, attempt, or artifact schemas.
- Existing worker and reviewer model configuration must continue to work.
- Existing project-level agent overrides must continue to load.
- Existing native behavior must remain unchanged when Superpowers is absent or the adapter falls back.
- Existing policy-mode configuration may produce a deprecation warning, but no migration should be required merely to test the concrete adapter.
- The current global `crew-superpowers-policy.ts` extension must remain removable and must not be loaded twice with the packaged adapter.

### Deferred roadmap migrations

- A future activated milestone that changes task or plan files must provide deterministic migration and fail-closed compatibility behavior.
- Future artifact configuration changes must map existing `artifacts.enabled` configuration or produce a clear deprecation warning.
- Future exact-review work must request manual scope rather than guess when commit ownership is unavailable.

## 17. Risks and Mitigations

### R1. Parallel Crew uses more model work than necessary

**Risk:** Multiple agents can duplicate context, exploration, or review.

**Mitigation:** Keep Crew invocation user-controlled, eliminate duplicated inputs and work by design, and use the small development eval suite to verify improvements.

### R2. External policy drift

**Risk:** Superpowers changes skill names or semantics.

**Mitigation:** Runtime discovery, compatibility metadata, behavioral tests, pinned/latest CI, and no copied skills.

### R3. Prompt conflicts

**Risk:** Crew instructions and Superpowers bootstrap disagree.

**Mitigation:** Compact system-level ownership invariants and direct selection of relevant skills instead of invoking the general `using-superpowers` workflow in dispatched agents.

### R4. Parallel Git ownership is ambiguous

**Risk:** Workers share commits or files.

**Mitigation:** Record commit ownership, validate ranges, surface overlaps, and use integration review. Fail safely when ownership cannot be proven.

### R5. Task-scoped review misses integration bugs

**Risk:** Narrow task review loses accidental cross-task visibility.

**Mitigation:** Explicit wave-level and optional final integration review.

### R6. Scoped repair preserves a flawed design

**Risk:** A repair worker fixes symptoms rather than architecture.

**Mitigation:** Allow `NEEDS_WORK` only when the reviewer explicitly confirms that the architecture, core approach, important assumptions, and public interfaces remain valid and the fixes are localized. Repair workers may escalate deeper discoveries, re-review includes a design sanity check, and one failed repair routes the task to `MAJOR_RETHINK` for re-planning or blocking.

### R7. Risk-based model routing misses subtle defects

**Risk:** A cheap reviewer underestimates a small dangerous change.

**Mitigation:** Never skip review solely because of size; treat sensitive paths and public interfaces as high risk; audit low-risk classifications during rollout.

### R8. Structured status suppresses useful communication

**Risk:** Workers may interpret structured routine events as a rule against talking to each other.

**Mitigation:** Explicitly preserve agent discretion to send useful DMs and broadcasts. Structure only predictable lifecycle status; do not impose message quotas.

### R9. Independent fork maintenance becomes excessive

**Risk:** Pi-messenger may remain inactive, leaving this project responsible for inherited bugs and Pi compatibility. If upstream development resumes later, its direction may differ substantially from the fork.

**Mitigation:** Maintain an independent test suite, releases, changelog, and supported-version policy. Preserve history and monitor upstream, but evaluate and import changes selectively rather than attempting automatic synchronization. Keep fork changes modular for our own maintenance, not for expected upstream acceptance.

### R10. Greenfield rewrite temptation

**Risk:** Rebuilding the entire runtime delays value and recreates solved lifecycle problems.

**Mitigation:** Use the focused fork as an evidence-gathering vehicle. Consider a new engine only if measured architectural friction repeatedly exceeds the cost of maintaining the fork.

## 18. Independent Maintenance Strategy

The fork must be treated as the authoritative product rather than a temporary staging area for upstream pull requests. Its roadmap, releases, tests, and launch criteria must not depend on participation or acceptance from either upstream project.

### 18.1 Pi-messenger base

Pi-messenger history and a read-only upstream remote should be preserved for attribution and monitoring. The project may selectively import useful upstream fixes if development resumes, but it must not assume that upstream will accept this fork's changes or provide future maintenance. Generic improvements should remain modular because that makes this fork easier to understand and maintain; possible upstream contribution is only an optional by-product.

### 18.2 Superpowers dependency

Superpowers must remain a stock external dependency. The project must dynamically discover it, document supported versions, and test the integration against supported pinned and current releases. Superpowers changes must be handled in the thin compatibility layer rather than by copying or modifying its skills.

### 18.3 Optional contributions

Changes may be offered to either upstream project when useful, but contribution work must not be required for a release and acceptance must never be assumed. Rejected, delayed, or unanswered contributions must not block the independent fork.

### 18.4 Rewrite threshold

A greenfield replacement should be considered only if evidence shows that maintaining the inherited pi-messenger architecture costs more or creates more risk than replacing the necessary runtime. Upstream inactivity alone is not sufficient reason to rewrite working orchestration machinery.

## 19. Product Decision Rules

Use these rules when requirements compete:

1. Deliver the concrete integration before building a generalized platform.
2. Preserve native execution behavior unless a focused reproduced blocker or immediate safety defect justifies a separate correction.
3. Correctness before model-use reduction.
4. Remove duplicate context before reducing review quality.
5. Deterministic controller behavior before LLM-authored coordination when that controller behavior is in an approved milestone.
6. Explicit integration review before broad task-review diffs.
7. Scoped repair before full restart for minor findings.
8. Full re-plan or block before endlessly repairing a major design failure.
9. Stock external policy content before copied prompts.
10. Optional complexity before mandatory complexity.
11. Measurement before claims of savings.
12. Maintainable modular boundaries before deep unrelated rewrites.
13. Extract a generic abstraction only after concrete behavior demonstrates its boundary.

## 20. Launch Criteria

### 20.1 Integration MVP

Super Pi Messenger may ship its first usable integration when:

- Stock Superpowers remains separately installed and no skill bodies are copied.
- Required installed skills are resolved dynamically by actual path.
- Existing Crew workers and reviewers receive only their intended compact starting guidance.
- The adapter does not select, recommend, or inject nested-orchestration workflows into ordinary Crew agents.
- Crew remains the sole orchestration and task authority.
- Superpowers absence preserves native pi-messenger behavior without warning.
- Missing required resources produce one actionable warning and complete native fallback.
- Selected skills, paths, reasons, and prohibited workflows are inspectable through tests and minimal status.
- Existing pi-messenger tests and project agent overrides remain green.
- Focused rendering tests cover every supported MVP role.
- Representative live acceptance demonstrates methodology availability and no nested orchestration.
- Documentation explains ownership inside and outside Crew.
- No broad scheduler, lease, attempt, review, repair, pause, recovery, artifact, planning, routing, or generic-provider redesign is imported without separate approval as a focused blocker correction.

### 20.2 Enhanced Crew release

An Enhanced Crew release may add only activated, independently reviewed milestones. Its criteria are defined by those milestones and may include exact task review scope, integration review, bounded repair, focused execution fixes, failure classification, recovery, or observability. It must preserve Integration MVP behavior and requirement traceability.

### 20.3 Full product vision

The full long-term product may additionally require:

- Correct task-owned review diffs under parallel waves
- Explicit integration and optional final review
- Design-validity-gated scoped repair and bounded re-review
- Evidence-selected execution correctness and recovery
- Quota/auth retry suppression and validated durable recovery
- Bounded artifact and parent-memory growth
- Complete active output access
- Context, planning, routing, coordination, packaging, and compatibility improvements
- Meaningful benefit on representative parallel workloads without unacceptable quality regression

## 21. Post-Launch Evaluation

After Integration MVP use, evaluate:

- Whether representative Crew agents can access and follow selected methodology
- Whether nested orchestration occurs despite the ownership policy
- Prompt size and clarity compared with the prior broad role matrix
- Native fallback and project agent override behavior
- Which execution, review, repair, reliability, or context failures occur often enough to justify later milestones
- Whether dynamic Superpowers compatibility survives updates
- Whether fork maintenance remains manageable

After later milestones activate, also evaluate whether integration review catches cross-task defects, scoped repair converges efficiently, recovery works safely, and structured status preserves useful communication.

A greenfield orchestration engine should be considered only if post-launch evidence shows that pi-messenger's internal architecture blocks core requirements across multiple independent subsystems and maintaining the fork costs more than replacing the necessary runtime.

## 22. Related Local Documents

- `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`
- `~/.pi/agent/docs/superpowers/specs/2026-07-26-crew-superpowers-policy-design.md`

Relevant upstream report:

- `nicobailon/pi-messenger#27` — raw Crew transcript amplification and artifact growth

## 23. Final Product Statement

Super Pi Messenger will first connect existing pi-messenger Crew roles to the separately installed stock Superpowers methodology through a thin concrete adapter. Pi-messenger remains the execution substrate and sole Crew orchestrator; Superpowers supplies compact role-appropriate engineering discipline; native behavior remains available when the adapter is inactive or falls back.

The first release is successful when both installed add-ons behave coherently without requiring an execution-engine rewrite. Review, repair, reliability, recovery, observability, context, routing, packaging, and generic-provider improvements remain long-term evidence-gated product goals rather than prerequisites for first value.

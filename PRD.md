# Product Requirements Document: Super Pi Messenger

**Product name:** Super Pi Messenger
**Repository:** Focused fork of `nicobailon/pi-messenger`  
**Date:** 2026-07-27  
**Status:** Approved through section-by-section review  
**Primary optimization target:** Coherent integration, quality, autonomy, parallel speed, and reduced duplicated work

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

It will add:

- A generic policy-provider interface
- A thin, dynamically loaded Superpowers adapter
- Exact task-owned review diffs
- Scoped repair and re-review workflows
- Explicit wave-level integration review
- Failure classification and bounded retries
- Reduced duplicated context and work without execution limits
- Compact, relevant agent context
- Structured routine status with flexible agent communication
- Bounded opt-in diagnostic artifacts

Superpowers will remain a separate stock installation and source of truth for its skills. The fork will not copy or rewrite Superpowers skill bodies.

Token accounting, cost dashboards, and usage thresholds are not part of the initial product. Existing provider usage metadata may be recorded by maintainers during development evals, but it will not be a user-facing subsystem or affect agent behavior.

## 2. Problem Statement

Pi-messenger and Superpowers solve complementary problems but do not currently integrate deeply.

Pi-messenger provides a strong multi-agent runtime, but current Crew behavior can consume excessive tokens and credits because it launches many independent sessions, repeats context, reviews overlapping changes, restarts entire tasks after minor feedback, and uses broad coordination prompts.

Superpowers provides disciplined planning, TDD, debugging, verification, and review workflows, but it does not provide pi-messenger's persistent multi-agent task room, dependency scheduler, messaging, reservations, presence, or Crew UI.

The existing local Crew–Superpowers adapter establishes the correct ownership boundary but is only a prompt overlay. It does not alter Crew's review, repair, retry, scheduling, or diff behavior. It also hardcodes the current Superpowers skill catalog and adds a large role matrix to every Crew agent.

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
- Policy providers own engineering-method guidance and role-specific quality standards.
- The user or outer session owns final integration decisions unless explicitly delegated.

### P2. No nested orchestration

Crew agents must not start another SDD controller, plan executor, parallel worker tree, or nested worktree unless a task explicitly requests that workflow.

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

Allow Crew behavior to use the installed stock Superpowers methodology through a generic policy boundary. Superpowers is the initial product integration; the boundary should not prevent future providers, but additional providers are not initial scope.

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

The first product version will not:

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

## 8. Success Definition

The product succeeds when the integrated Crew workflow:

1. Finishes suitable parallel work faster in wall-clock time than a comparable sequential Superpowers workflow.
2. Produces fewer avoidable retries and better methodology adherence than stock pi-messenger.
3. Uses substantially less duplicated reviewer and retry context than stock Crew.
4. Preserves or improves important-defect detection.
5. Does not start nested orchestration.
6. Preserves normal pi-messenger behavior when Superpowers is absent and falls back safely when it is unsupported.
7. Prevents unbounded artifact, retry, and quota-failure behavior.
8. Keeps external policy updates independent of pi-messenger releases.

## 9. Runtime Ownership

When pi-messenger and Superpowers are installed together, the compatibility layer activates automatically. The user does not select between builtin, Superpowers, or hybrid modes.

During a Crew run, pi-messenger owns orchestration and Superpowers supplies relevant engineering discipline. Outside Crew, Superpowers may guide the interactive workflow while pi-messenger's messaging, presence, and reservation tools remain available without injecting competing orchestration.

If Superpowers is not installed, the compatibility layer remains inactive and pi-messenger behaves exactly as it normally would. If Superpowers is installed but incompatible, the layer must warn and either use safe known mappings or suppress the incompatible Crew integration while allowing native pi-messenger behavior. It must never silently allow both systems to issue conflicting orchestration instructions.

## 10. System Architecture

### 10.1 Layer 1: Crew execution engine

The fork remains responsible for:

- Agent spawning
- Explicit role metadata
- Task graph and wave scheduling
- Task state
- Worker ownership
- File reservations
- Agent messaging
- Progress tracking
- Commit ownership
- Review package creation
- Repair lifecycle
- Integration review
- Failure classification
- Cancellation and recovery

### 10.2 Layer 2: Policy-provider interface

A generic interface supplies lifecycle-specific policy decisions.

Conceptual contract:

```ts
interface CrewPolicyProvider {
  id: string;
  version?: string;

  discover(context: PolicyDiscoveryContext): PolicyCapabilities;
  preparePlan(context: PlanningContext): PlanningPolicy;
  prepareWorker(context: WorkerContext): WorkerPolicy;
  prepareReview(context: ReviewContext): ReviewPolicy;
  prepareRepair(context: RepairContext): RepairPolicy;
  prepareIntegration(context: IntegrationContext): IntegrationPolicy;
  validateCompletion(context: CompletionContext): CompletionValidation;
}
```

The final TypeScript interface may differ, but it must preserve these lifecycle boundaries.

### 10.3 Layer 3: Superpowers adapter

The adapter must:

- Discover the installed Superpowers package through Pi resource metadata or configured package paths.
- Detect the installed version when available.
- Use actual installed skill names, descriptions, and paths.
- Select only the skills relevant to the current Crew role, task type, and attempt type.
- Preserve Crew ownership of orchestration.
- Prevent nested controllers, nested worktrees, and unauthorized integration actions.
- Warn when the installed major version is outside tested compatibility.
- Remain inactive when Superpowers is unavailable so native pi-messenger behavior is unchanged.

The adapter must not:

- Copy skill contents into this repository.
- Maintain a hardcoded claim that a fixed number of skills are installed.
- Invoke `using-superpowers` as a complete workflow inside dispatched Crew agents.
- Inject the full Superpowers skill matrix into every role.

### 10.4 Agent policy manifest

Before launching a Crew agent, the adapter must create a compact policy manifest that records:

- The agent's role, task, and attempt type
- The detected Superpowers version
- The required starting skills selected for the agent
- The installed paths used for those skills
- A short reason each skill was selected
- Any orchestration workflows explicitly prohibited for that agent

The manifest must be inspectable in tests and Crew status without storing the complete system prompt. It defines the agent's required starting guidance but must not prevent the agent from discovering and using other relevant installed skills.

### 10.5 Explicit Crew process metadata

Every spawned Crew process must receive explicit metadata rather than relying on prompt-heading detection:

```text
PI_CREW_ROLE=planner|worker|reviewer|analyst|integration-reviewer
PI_CREW_TASK_ID=<task-id when applicable>
PI_CREW_ATTEMPT_KIND=initial|repair|replan|review|rereview|integration
PI_CREW_POLICY_PROVIDER=superpowers|custom
```

Additional metadata may be added if it is stable, bounded, and useful.

## 11. Functional Requirements

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

The adapter must expose the detected Superpowers version and compatibility status in Crew status output.

### FR-POL-006

Unsupported major versions must produce a warning and configurable behavior:

- `warn`: continue with safe known mappings
- `strict`: suppress the incompatible Superpowers Crew integration and continue with native pi-messenger behavior
- `ignore`: continue with the installed integration without a compatibility warning

### FR-POL-007

If Superpowers is unavailable, the compatibility layer must remain inactive and pi-messenger must continue with its normal native behavior. A status indicator may report that integration is inactive, but Crew must not warn, block, or behave as if this were an error.

## 11.2 Role- and phase-specific skill selection

### FR-SKL-001

A normal feature worker should receive TDD and verification guidance.

### FR-SKL-002

A bug or failing-test worker should receive systematic-debugging, TDD, and verification guidance.

### FR-SKL-003

A review repair worker should receive receiving-code-review, relevant implementation discipline, and verification guidance.

### FR-SKL-004

A reviewer should receive review rubric and evidence-validation guidance without being instructed to dispatch another reviewer.

### FR-SKL-005

A planner should receive planning and decomposition principles without starting a second human approval loop inside autonomous Crew planning.

### FR-SKL-006

No Crew role may start SDD, executing-plans, nested worktrees, or branch-finishing workflows unless the assigned task explicitly requests the workflow itself.

### FR-SKL-007

The generated policy prompt must include only applicable skills and compact shared invariants.

### FR-SKL-008

Before launch, every Crew agent must have an inspectable policy manifest showing its selected Superpowers skills and why they were selected.

### FR-SKL-009

The controller must validate that every required skill in the manifest exists at the discovered installed path. Missing required skills must produce an actionable compatibility error rather than silently launching with incomplete guidance.

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

Crew status must display the active policy provider and compatibility status.

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

A representative configuration may look like:

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

The project must include regression tests for:

- Nested orchestration prevention
- Explicit role metadata
- Dynamic skill discovery
- Per-agent policy manifest selection and path validation
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

Policy-provider failures must not corrupt Crew task state.

### QR-007

Project-local policy code or configuration must obey Pi project trust rules.

### QR-008

Extensions and policy providers must be treated as trusted executable code and documented accordingly.

## 14. Initial Eval Requirements

The initial product must use a small, maintainable eval suite rather than building a general-purpose benchmark platform. It must cover three representative workflows:

1. Several independent tasks that can run in parallel
2. Parallel tasks that share an exported interface
3. A review returning `NEEDS_WORK` followed by scoped repair and re-review

Each eval must have a resettable repository fixture, a defined task, known acceptance checks, and a simple results record. All three task definitions and acceptance checks must be written before implementing the related product behavior, but the fixtures and baselines should be built incrementally alongside the relevant rollout phase. The integrated fork should be evaluated directly and compared with stock pi-messenger on the same tasks. A stock Superpowers-only run may be recorded as a useful reference, but it is not required for every eval or release gate.

Initial eval results should record:

- Whether the requested work and automated checks pass
- Important findings and escaped defects
- Correct task-review and integration-review scope
- Whether scoped repair resolves the original finding
- Unexpected nested orchestration
- Agent sessions, retries, review cycles, human interventions, and wall-clock duration
- Existing provider usage metadata when readily available

The eval tooling should remain simple: small fixtures, reset scripts, acceptance checks, and a Markdown or structured results file. It must not become a product telemetry system or a separate benchmark platform.

Provider failures, quota handling, large output access, worker crashes, and orchestrator recovery must be covered primarily by deterministic unit and integration tests. They may become model evals later if real failures show that deterministic tests are insufficient.

## 15. Rollout Plan

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

## Phase 1: Reliability and observability

- Fix raw artifact snapshot amplification.
- Implement actual artifact retention and caps.
- Prevent parent-process accumulated-event retention.
- Add explicit Crew role/task/attempt metadata.
- Add failure classification, quota/auth retry suppression, and deterministic durable-state capture for provider-forced pauses.

### Exit criteria

- Artifact growth is bounded in stress tests.
- Quota failures do not retry.
- Simulated quota exhaustion preserves durable task and repository state, releases reservations safely, and resumes through a validated recovery path.
- Recovery does not claim to preserve private model reasoning.
- Role detection does not depend on headings.

## Phase 2: Correct review scope

- Implement the shared-interface eval fixture and record its stock pi-messenger baseline before changing review behavior.
- Track task-owned commits.
- Build exact task review packages.
- Add structured review findings.
- Add explicit wave-level integration review.
- Add optional final branch review.

### Exit criteria

- Parallel task reviewers do not receive unrelated wave diffs.
- Cross-task interactions remain covered by integration review.
- Review packages are bounded and reproducible.
- The shared-interface eval passes its acceptance checks and has recorded comparative results.

## Phase 3: Repair lifecycle

- Implement the review-repair eval fixture and record its stock pi-messenger baseline before changing repair behavior.
- Add `initial` and `repair` attempt kinds.
- Define and enforce the design-validity gate for `NEEDS_WORK` repair eligibility.
- Implement one scoped repair for eligible `NEEDS_WORK` findings.
- Allow repair workers to escalate deeper problems to `MAJOR_RETHINK`.
- Implement design-aware scoped re-review.
- Add breakers and `MAJOR_RETHINK` re-plan/block behavior.

### Exit criteria

- Minor findings do not restart complete tasks.
- Focused repair is used only after the reviewer confirms that the core design remains sound.
- Repair workers and re-reviewers escalate deeper problems instead of patching around them.
- Re-review examines repair-owned changes and performs a design sanity check.
- Review loops are bounded.
- The review-repair eval passes its acceptance checks and has recorded comparative results.

## Phase 4: Policy-provider API and Superpowers adapter v2

- Add the generic policy-provider interface.
- Implement the Superpowers provider and safe native fallback behavior.
- Discover loaded skills dynamically.
- Add version compatibility checks.
- Create and validate an inspectable policy manifest for every Crew agent.
- Select only phase-relevant starting skills while allowing agents to discover additional relevant skills.
- Replace the current hardcoded role matrix with compact invariants.
- Resolve the `using-superpowers` dispatched-agent contradiction by using a Crew-specific bootstrap and direct relevant-skill selection.

### Exit criteria

- Stock Superpowers remains separately installed and updateable.
- Adding an unrelated Superpowers skill does not require editing a global skill-count assertion.
- Every Crew agent's selected starting skills and selection reasons are inspectable.
- Rendering tests and live acceptance tests demonstrate correct guidance for representative agent roles and task types.
- Crew agents do not start nested controllers.
- Policy prompts are smaller than the current adapter matrix.

## Phase 5: Context and planning efficiency

- Add canonical structured planner output.
- Generate Markdown from structured plans.
- Add adaptive plan review.
- Add task-spec versioning and deduplication.
- Add commit-keyed repository manifest.
- Add relevant-only skill injection.
- Preserve complete raw tool and test output with explicit truncation markers and chunked access.

### Exit criteria

- Fresh workers receive one current task spec.
- Planner output duplication is reduced.
- Stable project discovery is reused safely.
- Relevant skill paths remain discoverable.
- Large command output remains fully accessible to active workers and reviewers even when it cannot fit into one prompt.

## Phase 6: Routing and coordination

- Add quality-first reviewer/model routing.
- Use structured events for routine lifecycle status.
- Preserve agent judgment about when free-form communication is useful.
- Add optional low-risk review batching only after eval evidence.

### Exit criteria

- Model selection remains capable of meeting each role's quality requirements.
- Routine status does not create repetitive chatter.
- Agents can communicate useful findings without artificial message limits.
- High-risk work retains strong review.

## Phase 7: Independent packaging and compatibility maintenance

- Package the adapter through Pi's supported installation mechanism.
- Establish independent versioning, releases, changelog, and support documentation for the fork.
- Add compatibility CI against supported pinned and current Superpowers releases.
- Document the supported Pi and Superpowers version ranges.
- Monitor pi-messenger upstream without depending on new releases or contribution acceptance.
- Evaluate upstream changes individually and import only those that remain useful and compatible.

### Exit criteria

- The adapter is installable without hand-editing user files.
- The fork can be released, tested, and maintained without upstream participation.
- Fork divergence is documented and organized into clear modules.
- Superpowers compatibility failures are detected before a supported release is published.
- No milestone depends on an upstream pull request being accepted.

## 16. Migration and Backward Compatibility

- Existing policy-mode configuration must migrate to automatic compatibility-layer activation or produce a clear deprecation warning.
- Existing task and plan files should remain readable or have a deterministic migration.
- Existing `artifacts.enabled` configuration should map to the new artifact mode with a deprecation warning if names change.
- Existing worker and reviewer model configuration must continue to work.
- Existing project-level agent overrides must continue to load.
- If exact task commit ownership is unavailable for an old in-progress task, the system must request manual review scope rather than guessing.
- The current global `crew-superpowers-policy.ts` extension must be removable once adapter v2 is packaged and verified.

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

1. Correctness before model-use reduction.
2. Remove duplicate context before reducing review quality.
3. Deterministic controller behavior before LLM-authored coordination.
4. Explicit integration review before broad task-review diffs.
5. Scoped repair before full restart for minor findings.
6. Full re-plan or block before endlessly repairing a major design failure.
7. Stock external policy content before copied prompts.
8. Optional complexity before mandatory complexity.
9. Measurement before claims of savings.
10. Maintainable modular boundaries before deep unrelated rewrites.

## 20. Launch Criteria

Super Pi Messenger may be called an initial usable release when:

- Artifact storage and memory growth are bounded.
- Explicit role/task/attempt metadata is used.
- Task-owned review diffs are correct under parallel waves.
- Integration review exists.
- Scoped repair is allowed only after explicit design-validity confirmation, and deeper problems escalate to `MAJOR_RETHINK`.
- Scoped repair and re-review are bounded.
- Quota/auth failures do not retry.
- Provider-forced quota pauses preserve durable task and repository state for validated recovery without claiming to preserve interrupted model reasoning.
- Superpowers skills are dynamically discovered.
- Every Crew agent has a validated, inspectable policy manifest.
- Rendering and live acceptance tests cover representative role, task-type, and attempt combinations.
- No Superpowers skill bodies are vendored.
- Nested orchestration is prevented in unit and live tests.
- The compatibility layer activates automatically when both add-ons are installed.
- Agents can communicate useful findings without artificial message limits.
- Complete raw tool and test output remains accessible throughout implementation and review.
- Documentation explains ownership inside and outside Crew.
- The initial eval suite shows correct behavior and a meaningful benefit on at least one representative parallel workload without unacceptable quality regression.

## 21. Post-Launch Evaluation

After real use, evaluate:

- Whether users invoke Crew for appropriate workloads
- Whether integration review catches issues lost by task-scoped review
- Whether scoped repair converges more efficiently than full retries
- Whether dynamic Superpowers compatibility survives updates
- Whether structured routine status and flexible communication work well together
- Whether fork maintenance remains manageable

A greenfield orchestration engine should be considered only if post-launch evidence shows that pi-messenger's internal architecture blocks core requirements across multiple independent subsystems and maintaining the fork costs more than replacing the necessary runtime.

## 22. Related Local Documents

- `docs/superpowers/specs/2026-07-27-token-credit-efficiency-design.md`
- `~/.pi/agent/docs/superpowers/specs/2026-07-26-crew-superpowers-policy-design.md`

Relevant upstream report:

- `nicobailon/pi-messenger#27` — raw Crew transcript amplification and artifact growth

## 23. Final Product Statement

Super Pi Messenger will not attempt to merge two complete orchestration systems. It will preserve pi-messenger as the multi-agent execution substrate, preserve Superpowers as an independently updated methodology source, and connect them through an always-active compatibility layer backed by deterministic review, repair, and failure handling.

The product is successful if both installed add-ons behave as one coherent system: pi-messenger owns Crew orchestration, Superpowers supplies engineering discipline, and agents retain the freedom to communicate when they judge it useful.

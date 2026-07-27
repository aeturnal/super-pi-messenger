# Pi Super Messenger Token and Credit Efficiency Design

**Date:** 2026-07-27  
**Status:** Proposal for review  
**Optimization target:** Balanced — preserve autonomous multi-agent behavior and review quality while eliminating redundant token and credit usage

## 1. Executive Summary

Pi Super Messenger's defining value is not merely code generation. It coordinates multiple agents through planning, dependency-aware parallel work, file reservations, messaging, progress tracking, review, and autonomous execution. Any cost optimization that simply removes planners, workers, reviewers, or coordination would reduce spend by weakening the product's original purpose.

The recommended strategy is therefore:

> Eliminate duplicate context and repeated work before eliminating independent judgment.

The highest-value improvements are:

1. Review exact task-owned diffs instead of repeatedly reviewing an entire parallel wave.
2. Add one intentional wave-level integration review to preserve cross-task coverage.
3. Stop injecting and rereading the same task specification multiple times.
4. Use scoped repair attempts for actionable review findings instead of restarting an entire task.
5. Make review depth and model selection risk-aware while retaining review coverage.
6. Compact planner output by using one canonical structured representation.
7. Replace routine chatty coordination with event-driven, overlap-aware coordination.
8. Send workers only relevant skills and stable project context.
9. Classify failures so quota, configuration, and deterministic errors do not consume retries.
10. Add soft token/credit budgets and compact usage telemetry.
11. Keep raw diagnostic artifacts opt-in, filtered, size-capped, and outside normal repository state.

These changes retain multiple agents, parallel waves, autonomous execution, messaging, reservations, planning, and independent review. They change how much context agents receive and how retries are scoped.

## 2. Goals

- Significantly reduce unnecessary model input, output, and repeated agent turns.
- Preserve the multi-agent coordination model.
- Preserve independent implementation review.
- Preserve autonomous operation for well-specified tasks.
- Preserve the ability for agents to communicate when coordination is genuinely useful.
- Improve reliability so crashes and deterministic failures do not indirectly cause expensive reruns.
- Make token and credit consumption observable and controllable.
- Prefer changes that improve correctness and cost simultaneously.

## 3. Non-Goals

- Replacing Crew with a single long-running coding agent.
- Disabling review by default.
- Eliminating parallel execution.
- Preventing users from selecting highly capable models.
- Removing raw diagnostics entirely; they should remain available as an explicit bounded debug mode.
- Guaranteeing a fixed percentage reduction before representative benchmarks exist.

## 4. Evidence and Current Cost Shape

A retained Archivist run history provided the following approximate role-level token totals:

| Role | Completed runs | Recorded tokens | Approximate share |
|---|---:|---:|---:|
| Workers | 30 | 724,536 | 57% |
| Reviewers | 56 | 358,172 | 28% |
| Planners | 24 | 190,809 | 15% |

These are token shares, not necessarily credit shares. Credit weighting depends on provider pricing, model, cached input, reasoning mode, and subscription accounting. Reviewers and planners may represent a larger portion of credits when they use more expensive models than workers.

Retained input artifacts also showed repeated nontrivial prompts:

| Role | Inputs | Average input bytes | Maximum input bytes |
|---|---:|---:|---:|
| Worker | 30 | 9,526 | 19,123 |
| Reviewer | 56 | 14,656 | 47,335 |
| Planner | 24 | 34,758 | 71,888 |

These measurements do not prove that every byte is avoidable, but they show that workers are the largest aggregate token consumer, reviewers are numerous, and planner/reviewer prompts can be large.

Separately, raw artifact JSONL streams reached approximately 6 GB because accumulated streaming snapshots were persisted repeatedly. That disk amplification does not directly create billed model tokens, but it can cause memory exhaustion, crashes, retries, Git/tool pollution, and diagnostic turns that indirectly increase usage.

## 5. Design Principles

### 5.1 Preserve independent judgment

Do not reduce cost by silently removing all review or forcing every task onto the cheapest model. Independent review is a core quality mechanism.

### 5.2 Make context task-scoped

A worker or reviewer should receive the requirements, code, interfaces, and history needed for its task—not the whole run merely because the information is available.

### 5.3 Make integration review explicit

Task review and integration review are different activities. A task reviewer should see task-owned changes. A wave or final reviewer should intentionally examine interactions between tasks.

### 5.4 Prefer deterministic orchestration

Scheduling, task ownership, reservation conflicts, diff construction, Markdown rendering, retry classification, and budget enforcement should be controller logic where possible. Do not spend LLM turns deciding facts the orchestrator already knows.

### 5.5 Escalate based on evidence

Use stronger models, wider context, and additional review when risk signals justify them—not uniformly for every mechanical task.

### 5.6 Bound every autonomous loop

Retries, review cycles, messages, artifacts, context, and waves need explicit limits and failure classification.

## 6. Proposed Changes

## 6.1 Exact Task-Owned Review Diffs

### Current concern

A task records a base commit when it begins. Review later computes a diff from that base to current `HEAD`. When multiple workers begin from the same base and commit during one parallel wave, current `HEAD` may contain changes from several tasks. Each task reviewer can therefore receive repeated whole-wave changes rather than only the assigned task's implementation.

Potential consequences:

- The same diff is billed as reviewer input multiple times.
- Reviewers inspect unrelated files.
- Findings can be attributed to the wrong task.
- False `NEEDS_WORK` verdicts can cause unnecessary worker retries.
- A task review may look like integration review without having an integration-review prompt or rubric.

### Proposed change

Persist exact task ownership information when `task.done` is called:

- Starting commit
- Task-owned commit SHAs
- Final task commit
- Changed-file list
- Test evidence

Build the reviewer package from the task-owned commit range rather than `base_commit..HEAD`.

If commits are not reliably task-exclusive, record a patch or changed-file ownership manifest at completion and validate it before review.

### Degradation risk

A task-scoped reviewer may no longer notice interactions with changes made by concurrent tasks.

### Mitigation

Add one explicit wave-level integration review after all task-scoped reviews pass. It should examine:

- Combined wave diff
- Cross-task interfaces
- Shared files
- Dependency contracts
- Conflicting assumptions
- Integration test evidence

This replaces several duplicated accidental integration views with one intentional integration review.

### Expected effect

High potential savings when waves contain multiple tasks or large diffs. Task review attribution and correctness should improve rather than degrade if integration review is added.

## 6.2 Version-Aware Task Specification Deduplication

### Current concern

The generated worker assignment already includes the task specification. The worker protocol then tells the worker to call `task.show` and read the task specification file before implementation. A fresh worker can receive the same requirements multiple times and incur extra model turns after tool results.

### Proposed change

Use one canonical task specification per worker attempt:

- Embed the complete task spec in the assignment for a fresh first attempt.
- Include a task-spec version or content hash.
- Tell the worker not to reread the spec when the embedded version is current.
- Require re-reading for retries, resumed tasks, manually assigned workers, or changed versions.

An alternative is to pass only a spec path, but that forces another tool/model turn. For normal spawned workers, one direct injection is likely more efficient.

### Degradation risk

A worker could operate from stale assignment text if the task is revised after prompt construction. Re-anchoring also helps workers recover from confusing context.

### Mitigation

- Compare the assignment's task-spec hash to current task state before the first edit.
- Force rereading when the hash differs.
- Always reread on retry or resume.
- Keep `task.show` available for ambiguity and status inspection.

### Expected effect

Moderate recurring savings across every worker, with low quality risk when version checking is enforced.

## 6.3 Compact Worker Protocol

### Current concern

Static worker instructions appear in the worker system prompt and generated assignment. Coordination sections also contain lengthy examples and repeated procedural rules. Static text is paid for in every fresh worker context, even when the task has no overlap with other work.

### Proposed change

Split instructions into:

1. A short stable worker protocol suitable for provider prompt caching.
2. Dynamic task context containing only task-specific facts.
3. Optional coordination guidance injected only when overlap or dependencies require it.

Replace repeated code examples with concise action names. The tool schema already describes invocation syntax.

### Degradation risk

Over-compression can make worker behavior less reliable, especially for file reservation, task completion, or shutdown handling.

### Mitigation

- Retain all behavioral requirements, but state each once.
- Add protocol conformance tests for required calls and shutdown behavior.
- Measure task completion failures before and after prompt changes.
- Keep critical safety instructions explicit rather than relying on implication.

### Expected effect

Small-to-moderate savings per worker, accumulating over many tasks.

## 6.4 Canonical Structured Planner Output

### Current concern

The planner currently produces a PRD summary, reviewed resources, sequential implementation steps, a Markdown task graph, and a JSON task graph. The Markdown and JSON task definitions duplicate one another. This larger output is then passed into plan review and potentially a refinement pass.

### Proposed change

Use one canonical structured result, for example:

```json
{
  "summary": "...",
  "gaps": ["..."],
  "constraints": ["..."],
  "resourcesReviewed": ["..."],
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "acceptanceCriteria": ["..."],
      "dependsOn": [],
      "skills": [],
      "risk": "normal"
    }
  ]
}
```

Generate human-readable Markdown and diagrams deterministically from this structure.

### Degradation risk

Free-form planning rationale and human readability may decline. A rigid schema can also constrain useful planner observations.

### Mitigation

- Retain compact `summary`, `gaps`, `constraints`, and optional `notes` fields.
- Render readable Markdown automatically.
- Permit bounded free-form notes for exceptional concerns.
- Validate the structured result and ask the planner to repair schema errors without repeating exploration.

### Expected effect

Moderate planner-output savings and larger downstream savings during plan review/refinement.

## 6.5 Adaptive Planning Passes

### Current concern

Multiple planner/reviewer refinement passes can reread the PRD, previous plan, progress history, and review feedback. Small or precise requests may not benefit enough to justify another expensive pass.

### Proposed change

Default to one planning pass and run plan review/refinement only when triggered by evidence such as:

- Large task count
- Ambiguous or incomplete requirements
- Security or migration work
- Long dependency chains
- Planner-reported low confidence
- Invalid task graph
- User-requested deep planning

A reviewer `SHIP` verdict should terminate refinement immediately. Refinement prompts should contain structured findings and the prior canonical plan, not an ever-growing prose history.

### Degradation risk

Some plans that would improve during a second pass may proceed with unnoticed gaps.

### Mitigation

- Use deterministic graph and schema validation on every plan.
- Preserve manual plan review.
- Trigger review for high-risk domains.
- Surface planner confidence and unresolved gaps to the user.

### Expected effect

High savings for frequent small plans; minimal impact on complex plans when adaptive triggers work correctly.

## 6.6 Risk-Aware Review Depth and Model Routing

### Current concern

Uniform review sends every completed task to the same reviewer model and rubric regardless of risk, complexity, or diff size. A documentation edit and a concurrency-sensitive authorization change may receive the same expensive treatment.

### Proposed change

Retain review coverage but choose review depth and model using risk signals:

- Changed-file count and diff size
- Security, authentication, billing, migration, or concurrency paths
- Public API or schema changes
- Test failures or missing test evidence
- Worker-reported concerns
- Task risk assigned by the planner
- Dependency fan-out

Example policy:

| Risk | Review behavior |
|---|---|
| Mechanical | Cheap reviewer, focused rubric |
| Normal | Standard reviewer, complete task rubric |
| High | Most capable reviewer, wider context and integration checks |

### Degradation risk

A classifier may underestimate a deceptively small but dangerous change. Cheaper reviewers may miss defects a stronger model would catch.

### Mitigation

- Never skip review solely because a diff is small.
- Treat sensitive paths and public interfaces as high risk regardless of size.
- Allow users and planners to force high-risk review.
- Audit a sample of low-risk reviews with a stronger model during rollout.
- Escalate when the cheap reviewer reports uncertainty.

### Expected effect

Potentially high credit savings because reviewer models can be expensive, with moderate quality risk if classification is poorly designed.

## 6.7 Optional Batching of Small Reviews

### Current concern

Each tiny task incurs a new reviewer session with fixed system-prompt and startup context.

### Proposed change

Allow one reviewer to inspect a small batch of related, low-risk tasks while producing a separate verdict for each task.

Batch only when:

- Diffs are small
- Tasks are low risk
- Tasks are related or share a wave
- Total review package remains bounded

### Degradation risk

The reviewer may give less attention to each task, confuse requirements, or produce findings that are harder to attribute.

### Mitigation

- Preserve distinct task specs and diff sections.
- Require a separate verdict and findings list per task.
- Set strict batch-size and token limits.
- Never batch high-risk tasks.
- Fall back to individual review when any task receives an uncertain verdict.

### Expected effect

Moderate savings for granular plans containing many small tasks. This should remain optional until benchmarked.

## 6.8 Scoped Repair Attempts

### Current concern

A `NEEDS_WORK` verdict resets the task and starts a fresh worker. The new worker may repeat repository exploration, task reading, broad tests, and already-correct implementation work.

### Proposed change

Introduce a repair attempt containing:

- Original task spec or canonical path
- Exact reviewer findings
- Reviewed commit range
- Current implementation summary
- Diff since the reviewed state
- Required targeted tests

The repair worker should address the findings and append evidence. Re-review should examine only the repair diff and original open findings.

### Degradation risk

A narrowly focused repair worker can preserve a fundamentally flawed approach or fix symptoms rather than root causes. It also provides fewer fresh eyes.

### Mitigation

- Use scoped repair only for `NEEDS_WORK`.
- Use a full fresh worker for `MAJOR_RETHINK`.
- Allow one scoped repair before escalating to a fresh full-context worker.
- Include the original task requirements, not only reviewer findings.
- Let reviewers escalate a finding from repairable to architectural.

### Expected effect

High savings when review findings are local and actionable. Quality can improve because repair and re-review are more focused.

## 6.9 Failure Classification and Retry Suppression

### Current concern

Not every failure is transient or repairable. Quota exhaustion, authentication failures, invalid configuration, missing tools, deterministic test failures, and orchestration bugs can consume repeated attempts without any changed conditions.

### Proposed change

Classify failures before retrying:

| Failure class | Behavior |
|---|---|
| Rate limit with retry time | Wait once using provider guidance |
| Quota/credit exhausted | Pause run; do not retry |
| Authentication/configuration | Block and surface actionable error |
| Missing dependency/tool | Block unless controller can install/resolve deterministically |
| Worker crash | Retry once with recovery context |
| Review `NEEDS_WORK` | Scoped repair |
| Review `MAJOR_RETHINK` | Block or re-plan |
| Identical repeated failure | Stop retrying |

Store a normalized failure fingerprint. Do not retry an unchanged task after the same deterministic failure beyond its configured limit.

### Degradation risk

Overly conservative classification may stop a run that would have recovered from a transient error.

### Mitigation

- Distinguish explicit provider 4xx categories.
- Honor `Retry-After` for rate limits.
- Permit manual retry and per-class configuration.
- Include the reason for suppression in Crew status.
- Retry unknown crashes once before blocking.

### Expected effect

Very high savings during failure conditions, plus improved reliability and predictability.

## 6.10 Event-Driven, Overlap-Aware Coordination

### Current concern

`chatty` coordination can inject concurrent tasks, recent activity, ready tasks, announcement instructions, peer messaging rules, and claim-next guidance into every worker. Incoming direct messages can trigger additional model turns. Routine announcements provide limited value when the orchestrator already tracks task state.

### Proposed change

Make routine coordination minimal and escalate based on concrete events:

- Always enforce reservations.
- Notify workers automatically on file-reservation overlap.
- Inject peers only when tasks share files, interfaces, or direct dependencies.
- Notify consumers when an exported interface changes.
- Keep manual messaging available.
- Let the orchestrator assign subsequent tasks instead of prompting workers to discover and claim them.
- Disable routine start/completion broadcasts by default; task/feed events already record them.

### Degradation risk

Workers lose ambient awareness and may miss unexpected relationships. Fewer proactive conversations make the product feel less like a shared agent chat room.

### Mitigation

- Preserve the overlay, feed, DMs, and broadcasts.
- Escalate automatically on conflicts and interface dependencies.
- Let users choose `chatty` for exploratory work.
- Provide concise shared interface-change events.
- Measure conflicts and integration findings after changing defaults.

### Expected effect

Moderate savings in prompts and steering turns, especially with high concurrency. Some social/ambient coordination is intentionally reduced, but meaningful coordination remains.

## 6.11 Relevant-Only Skill Injection

### Current concern

Every worker can receive the full discovered skill catalog. Users with many installed skills pay repeated catalog context even when only one skill is relevant.

### Proposed change

Send:

- Full details for planner-recommended skills
- Names only for a small number of related alternatives
- A discovery action or catalog path for everything else

The full catalog remains available on demand.

### Degradation risk

A planner may fail to recommend a useful skill, and the worker may not discover it independently.

### Mitigation

- Improve planner tagging using task keywords and file types.
- Include a compact names-only index when reasonably sized.
- Add a cheap deterministic `skill.search` or `skill.list` action.
- Allow the worker to request the complete catalog.

### Expected effect

Small savings in installations with few skills, potentially significant savings when catalogs are large.

## 6.12 Commit-Keyed Repository Manifest

### Current concern

Fresh agents repeatedly inspect stable project facts such as package commands, source roots, frameworks, test locations, and conventions.

### Proposed change

Create a compact project manifest during planning or deterministic discovery:

```json
{
  "commit": "<sha>",
  "languages": ["typescript"],
  "sourceRoots": ["crew", "tests"],
  "testCommand": "npm test",
  "typecheckCommand": "npm run typecheck",
  "frameworks": [],
  "conventions": ["..."],
  "keyConfigFiles": ["package.json", "tsconfig.json"]
}
```

Workers receive this for orientation and inspect only task-relevant code directly.

### Degradation risk

A stale or incorrect manifest can mislead workers. Summaries can omit task-specific conventions.

### Mitigation

- Tie the manifest to a commit and hashes of key configuration files.
- Regenerate when those inputs change.
- Treat it as orientation, not authoritative source code.
- Require direct inspection of files the task modifies.

### Expected effect

Moderate savings in repeated repository discovery across many fresh workers.

## 6.13 Stable Prompt Prefixes and Provider Caching

### Current concern

Fresh agents necessarily reload system instructions. If static and dynamic content are interleaved or frequently reordered, provider prompt caching may be less effective.

### Proposed change

Structure spawned-agent prompts as:

1. Stable role/system protocol
2. Stable tool and safety instructions
3. Stable project manifest
4. Dynamic task context
5. Dynamic retry/review context

Keep stable sections byte-identical across agents of the same role where possible. Record cache-read metrics separately from uncached input.

### Degradation risk

Designing for cache stability can tempt maintainers to retain irrelevant common context or constrain necessary prompt changes.

### Mitigation

- Optimize only genuinely stable prefixes.
- Do not preserve obsolete instructions for cache hits.
- Measure provider-specific cache behavior rather than assuming savings.
- Keep cache optimization separate from correctness semantics.

### Expected effect

Provider-dependent. Potentially meaningful credit reduction where cached input is discounted.

## 6.14 Tool Output and Test Evidence Compaction

### Current concern

Broad test commands, repository listings, and verbose tool output can remain in a worker context for subsequent turns. Reviewers may receive repeated test logs when a concise evidence summary would suffice.

### Proposed change

- Prefer targeted tests during task work and repair.
- Run the full suite at wave/final integration boundaries.
- Store complete logs in bounded files when needed.
- Send reviewers the command, exit status, test counts, and relevant failures rather than entire successful logs.
- Truncate repetitive tool output with a path to the bounded full log.

### Degradation risk

Truncation can hide warnings, flaky behavior, or subtle failures. Targeted tests can miss regressions outside the task.

### Mitigation

- Never truncate failing sections needed for diagnosis.
- Preserve full bounded logs locally.
- Run broader tests at explicit integration gates.
- Let high-risk tasks request full-suite evidence.

### Expected effect

Moderate savings for test-heavy repositories and multi-turn debugging tasks.

## 6.15 Soft Token and Credit Budgets

### Current concern

Autonomous mode can launch many sessions and retries without a clear projected or enforced cost boundary.

### Proposed change

Add configurable budgets:

```json
{
  "budgets": {
    "maxTokensPerTask": 75000,
    "maxTokensPerRun": 500000,
    "maxReviewerTokens": 20000,
    "onLimit": "pause"
  }
}
```

Before autonomous work, show an estimate based on task count, configured models, historical medians, review policy, and maximum retries.

Use soft warnings before hard limits. Pause before launching the next agent rather than terminating an agent mid-edit.

### Degradation risk

A run may pause near completion, require more human intervention, or interrupt the expectation of fully hands-off execution.

### Mitigation

- Finish the active agent before pausing.
- Warn at configurable thresholds.
- Allow task- and role-specific exceptions.
- Show remaining work and estimated additional cost.
- Permit one explicit user-approved extension.

### Expected effect

Does not inherently reduce required work, but prevents surprise runaway spend and makes cost a controllable product behavior.

## 6.16 Compact Usage Telemetry

### Current concern

Disabling raw artifacts prevents disk amplification but also removes useful historical cost data. Raw event streams are unnecessary for routine cost analysis.

### Proposed change

Write one compact record per agent run:

```json
{
  "role": "worker",
  "taskId": "task-3",
  "attempt": 1,
  "model": "provider/model",
  "inputTokens": 12000,
  "outputTokens": 3500,
  "cacheReadTokens": 9000,
  "durationMs": 84000,
  "result": "done"
}
```

Expose summaries by role, task, model, wave, review cycle, and failure class.

### Degradation risk

Compact telemetry cannot reconstruct low-level streaming/provider failures.

### Mitigation

Keep a separate bounded raw-debug mode for explicit troubleshooting. Routine telemetry should not attempt to replace forensic traces.

### Expected effect

Minimal token effect by itself, but essential for measuring and validating every other optimization.

## 6.17 Bounded, Opt-In Raw Diagnostics

### Current concern

Raw artifacts currently persist full streaming updates and can grow quadratically because each delta carries accumulated message snapshots. The resulting disk and memory pressure can crash orchestration and indirectly cause expensive retries.

### Proposed change

- Default raw artifacts to disabled or compact mode.
- Do not persist accumulated `message_update` snapshots verbatim.
- Store deltas only, or retain `message_start`, `message_end`, and tool events.
- Cap bytes per run.
- Rotate and implement `cleanupDays` retention.
- Store debug artifacts outside the working repository by default.
- Do not retain every parsed accumulated event in the parent process.

### Degradation risk

Maintainers lose exact intermediate snapshots and some deep forensic detail.

### Mitigation

- Support explicit short-lived raw tracing.
- Preserve final messages and tool events.
- Include provider response identifiers and error metadata.
- Make caps and retention configurable.

### Expected effect

Little direct token reduction, but substantial reliability improvement and prevention of crash-driven reruns.

## 6.18 Persistent or Warm Worker Pool — Later Option

### Current concern

Fresh workers repeatedly reconstruct repository context. A warm worker or lobby worker can retain useful context between related tasks.

### Proposed change

Optionally reuse a worker for closely related sequential tasks, with explicit context reset boundaries and a compact handoff.

### Degradation risk

This changes the fresh-agent model and introduces:

- Context pollution
- Stale assumptions
- Cross-task instruction leakage
- Larger accumulated contexts
- Harder reproducibility
- More complex lifecycle recovery

A warm worker can eventually cost more if every later turn rereads a large context.

### Mitigation

- Do not make this an initial optimization.
- Reuse only for tightly related tasks.
- Compact or reset between tasks.
- Enforce maximum context and task count.
- Benchmark against fresh workers.

### Expected effect

Potentially high savings for related tasks, but high architectural and quality risk. This is not recommended until the lower-risk changes are complete.

## 7. Recommended Balanced Policy

A balanced default should behave approximately as follows:

### Planning

- One initial planner pass.
- Deterministic schema and dependency validation.
- Plan review only for triggered risk/complexity or explicit user request.
- Canonical structured plan with generated Markdown.

### Work

- Fresh worker per independent task.
- One current task spec, not repeated copies.
- Commit-keyed repository manifest.
- Relevant skills only, with on-demand discovery.
- Minimal default coordination with automatic escalation on overlap.
- Targeted tests during implementation.

### Review

- Every task receives review.
- Exact task-owned diff.
- Model and depth selected by risk.
- Small low-risk batching optional.
- One explicit wave-level integration review.
- Full-suite verification at integration boundaries.

### Retry

- One scoped repair for `NEEDS_WORK`.
- Scoped re-review of repair diff.
- Fresh stronger worker for `MAJOR_RETHINK` only after re-planning or explicit decision.
- No retry for quota/auth/configuration failures.
- Repeated identical failures block rather than loop.

### Observability

- Compact per-run token/cost telemetry enabled.
- Soft run/task budgets.
- Raw diagnostics disabled by default and bounded when enabled.

## 8. Degradation Summary

| Change | Main degradation | Mitigation | Residual risk |
|---|---|---|---|
| Task-scoped diffs | Missed cross-task interactions | Explicit wave integration review | Integration reviewer may still miss subtle coupling |
| Spec deduplication | Stale worker assignment | Spec hash and forced reread on changes/retries | Hash/version logic can fail if not applied consistently |
| Compact protocol | Workers miss procedural expectations | Protocol tests; retain safety-critical rules | Some model-dependent adherence loss |
| Structured planner output | Less free-form rationale | Generated Markdown and bounded notes | Schema may constrain novel observations |
| Adaptive planning | Skipped useful refinement | Risk triggers and deterministic validation | Trigger false negatives |
| Risk-aware reviewers | Cheap reviewer misses subtle bug | Never skip; sensitive-path escalation | Model quality remains variable |
| Batched reviews | Less task-specific attention | Small batches and separate verdicts | Shallower inspection |
| Scoped repair | Preserves flawed approach | Only for `NEEDS_WORK`; escalate rethink | Reviewer findings may be incomplete |
| Selective coordination | Reduced ambient awareness | Conflict/interface event escalation | Unexpected relationships may be missed |
| Skill filtering | Useful skill not surfaced | Search/list and names-only index | Planner recommendation errors |
| Repository manifest | Stale summary | Commit/config hash invalidation | Summary omissions |
| Prompt caching | Irrelevant stable context retained | Optimize only true stable prefixes | Provider-dependent behavior |
| Test-output compaction | Hidden warnings or regressions | Preserve failures; integration suites | Flaky signals may be lost |
| Budgets | Autonomous run pauses | Soft warnings and finish-current-agent | More human intervention |
| Compact telemetry | Less forensic detail | Separate bounded debug mode | Rare provider bugs harder to reconstruct |
| Bounded artifacts | Missing intermediate stream state | Opt-in trace mode | Reduced postmortem fidelity |
| Warm workers | Context pollution and staleness | Strict reuse/reset limits | High architectural complexity |

## 9. Prioritized Roadmap

### Phase 0: Measurement and correctness foundations

1. Add compact token/cache/cost telemetry.
2. Add regression benchmarks for representative task, wave, review, and retry flows.
3. Fix raw artifact amplification and parent event retention.
4. Implement failure classification for quota/auth/config errors.

### Phase 1: High-value, low-degradation changes

1. Record task-owned commit ranges.
2. Review exact task diffs.
3. Add explicit wave-level integration review.
4. Deduplicate fresh-worker task specifications with version checks.
5. Compact static worker and coordination prompts without removing requirements.
6. Implement scoped re-review packages.

### Phase 2: Adaptive context and model use

1. Canonical structured planner output.
2. Adaptive planning review triggers.
3. Risk-aware reviewer model selection.
4. Relevant-only skill injection.
5. Commit-keyed repository manifest.
6. Tool/test output compaction.

### Phase 3: Controlled autonomy

1. Scoped repair workers.
2. Soft token/credit budgets and estimates.
3. Event-driven coordination defaults.
4. Optional small-task review batching.

### Phase 4: Experimental architecture

1. Warm worker reuse for tightly related tasks.
2. More advanced shared-context or project-memory mechanisms.

Phase 4 should proceed only if metrics show that fresh-agent repository reconstruction remains a dominant cost after Phases 1–3.

## 10. Benchmark and Acceptance Plan

Every optimization should be evaluated against a baseline using the same repositories and tasks.

### Metrics

- Total input tokens
- Uncached input tokens
- Cache-read tokens
- Output/reasoning tokens
- Provider-reported cost or credit usage when available
- Agent sessions by role
- Model turns and tool calls
- Review retries
- Task success rate
- Review findings by severity
- Integration defects found after task review
- Wall-clock duration
- Worker crashes and blocked tasks
- Human interventions

### Representative scenarios

1. Small mechanical task
2. Documentation-only task
3. Three independent parallel tasks
4. Tasks sharing an exported interface
5. High-risk authentication or migration task
6. Review returning `NEEDS_WORK`
7. Review returning `MAJOR_RETHINK`
8. Provider rate limit
9. Provider quota exhaustion
10. Large test output

### Balanced acceptance criteria

A change should not become the default solely because it lowers tokens. It should demonstrate:

- Meaningful reduction in uncached token or credit usage
- No material decrease in task completion rate
- No material increase in escaped important defects
- No increase in unresolved integration failures
- Bounded retries and artifact growth
- Clear user visibility when autonomy pauses or review depth changes

## 11. Recommended Initial Upstream Proposal

The first upstream proposal should be deliberately narrow:

1. Add compact per-agent usage telemetry.
2. Persist task-owned commit ranges.
3. Build exact task review packages.
4. Add one wave-level integration review option.
5. Deduplicate task-spec re-anchoring for fresh first attempts.
6. Filter or disable raw `message_update` artifact persistence and implement retention.

This package targets demonstrated duplication and reliability problems without initially changing default model quality, removing review, or redesigning agent lifecycles.

After measuring those changes, propose adaptive reviewer routing, scoped repair workers, and event-driven coordination as separate follow-ups.

## 12. Decision Summary

The balanced optimization strategy preserves Pi Super Messenger's identity:

- Multiple specialized agents remain.
- Independent workers remain fresh by default.
- Parallel waves remain.
- Messaging and reservations remain.
- Automated planning remains.
- Every task remains reviewed.
- Integration review becomes explicit.
- Autonomous execution remains, with bounded failure and cost behavior.

The primary reduction comes from sending each agent the correct context exactly once, reviewing each change at the correct scope, and avoiding complete reruns for local or deterministic failures.

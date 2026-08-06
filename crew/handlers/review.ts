/**
 * Crew - Review Handler
 * 
 * Spawns reviewer with git diff context for task or plan review.
 * Simplified: works with current plan
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CrewParams } from "../types.js";
import { result } from "../utils/result.js";
import { spawnAgents } from "../agents.js";
import { discoverCrewAgents } from "../utils/discover.js";
import { loadCrewConfig } from "../utils/config.js";
import { parseVerdict, type ParsedReview } from "../utils/verdict.js";
import {
  invokeLegacyReviewer,
  LegacyReviewInvocationError,
  type LegacyReviewerProvider,
} from "../execution/reviews.js";
import * as store from "../store.js";

export async function execute(
  params: CrewParams,
  ctx: ExtensionContext
) {
  const cwd = ctx.cwd ?? process.cwd();
  const { target, type } = params;
  const config = loadCrewConfig(store.getCrewDir(cwd));
  const reviewerModel = config.models?.reviewer;

  if (!target) {
    return result("Error: target (task ID) required for review action.\n\nUsage: pi_messenger({ action: \"review\", target: \"task-1\" })", {
      mode: "review",
      error: "missing_target"
    });
  }

  // Check for reviewer agent
  const availableAgents = discoverCrewAgents(cwd);
  const hasReviewer = availableAgents.some(a => a.name === "crew-reviewer");
  if (!hasReviewer) {
    return result("Error: crew-reviewer agent not found. Required for code review.", {
      mode: "review",
      error: "no_reviewer"
    });
  }

  // Determine review type: "impl" for task, "plan" for plan review
  const reviewType = type ?? (target.startsWith("task-") ? "impl" : "plan");

  if (reviewType === "impl") {
    return reviewImplementation(cwd, target, reviewerModel);
  } else {
    return reviewPlan(cwd, reviewerModel);
  }
}

// =============================================================================
// Implementation Review
// =============================================================================

export async function reviewImplementation(
  cwd: string,
  taskId: string,
  modelOverride?: string,
  provider?: LegacyReviewerProvider,
) {
  try {
    const verdict = await invokeLegacyReviewer(cwd, taskId, modelOverride, provider);
    const text = `# Review: ${taskId}

**Verdict:** ${verdict.verdict}

${verdict.summary}

${verdict.issues.length > 0 ? `## Issues\n${verdict.issues.map(issue => `- ${issue}`).join("\n")}` : ""}

${verdict.suggestions.length > 0 ? `## Suggestions\n${verdict.suggestions.map(suggestion => `- ${suggestion}`).join("\n")}` : ""}

${verdict.verdict === "SHIP" ? "✅ Ready to merge!" : verdict.verdict === "NEEDS_WORK" ? "⚠️ Address issues and re-review." : "🔄 Consider re-planning this task."}`;

    return result(text, {
      mode: "review",
      type: "impl",
      taskId,
      verdict: verdict.verdict,
      issueCount: verdict.issues.length,
      suggestionCount: verdict.suggestions.length,
    });
  } catch (error) {
    const code = error instanceof LegacyReviewInvocationError
      ? error.code
      : "review_provider_failed";
    return result(`Error: Reviewer failed: ${error instanceof Error ? error.message : String(error)}`, {
      mode: "review",
      error: code,
      taskId,
    });
  }
}

// =============================================================================
// Plan Review
// =============================================================================

async function reviewPlan(cwd: string, modelOverride?: string) {
  const plan = store.getPlan(cwd);
  if (!plan) {
    return result("Error: No plan found.", {
      mode: "review",
      error: "no_plan"
    });
  }

  const planSpec = store.getPlanSpec(cwd);
  const tasks = store.getTasks(cwd);

  // Build task overview
  const taskOverview = tasks.map(t => {
    const spec = store.getTaskSpec(cwd, t.id);
    const deps = t.depends_on.length > 0 ? ` (deps: ${t.depends_on.join(", ")})` : "";
    const specPreview = spec && !spec.includes("*Spec pending*")
      ? `\n  ${spec.slice(0, 200)}${spec.length > 200 ? "..." : ""}`
      : "";
    return `- ${t.id}: ${t.title}${deps}${specPreview}`;
  }).join("\n");

  // Build review prompt
  const prompt = `# Plan Review Request

## Plan Information

**PRD:** ${store.getPlanLabel(plan)}
**Tasks:** ${tasks.length}
**Progress:** ${plan.completed_count}/${plan.task_count}

## Plan Specification

${planSpec || "*No spec available*"}

## Task Breakdown

${taskOverview || "*No tasks*"}

## Your Review

Review this plan for:
1. Completeness - Are all requirements covered?
2. Task granularity - Are tasks appropriately sized?
3. Dependencies - Are dependencies correct and complete?
4. Gaps - Are there missing tasks or edge cases?
5. Parallelism - Are there unnecessary sequential dependencies? Tasks that don't share files or types should be independent.
6. Critical path - What's the longest dependency chain? Could it be shortened?

Output your verdict as SHIP (plan is solid), NEEDS_WORK (minor adjustments), or MAJOR_RETHINK (fundamental issues).`;

  // Spawn reviewer
  const [reviewResult] = await spawnAgents([{
    agent: "crew-reviewer",
    task: prompt,
    modelOverride,
  }], cwd);

  if (reviewResult.exitCode !== 0) {
    return result(`Error: Reviewer failed: ${reviewResult.error ?? "Unknown error"}`, {
      mode: "review",
      error: "reviewer_failed"
    });
  }

  // Parse verdict
  const verdict: ParsedReview = parseVerdict(reviewResult.output);

  const text = `# Plan Review

**PRD:** ${store.getPlanLabel(plan)}
**Verdict:** ${verdict.verdict}

${verdict.summary}

${verdict.issues.length > 0 ? `## Issues\n${verdict.issues.map(i => `- ${i}`).join("\n")}` : ""}

${verdict.suggestions.length > 0 ? `## Suggestions\n${verdict.suggestions.map(s => `- ${s}`).join("\n")}` : ""}

${verdict.verdict === "SHIP" ? "✅ Plan is ready for execution!" : verdict.verdict === "NEEDS_WORK" ? "⚠️ Adjust plan before starting work." : "🔄 Consider re-planning with more context."}`;

  return result(text, {
    mode: "review",
    type: "plan",
    prd: plan.prd,
    verdict: verdict.verdict,
    issueCount: verdict.issues.length,
    suggestionCount: verdict.suggestions.length
  });
}

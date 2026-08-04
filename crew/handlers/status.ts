/**
 * Crew - Status Handler
 * 
 * Shows plan progress and task status.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { result } from "../utils/result.ts";
import { discoverCrewAgents } from "../utils/discover.ts";
import { uninstallAgents } from "../utils/install.ts";
import { loadCrewConfig } from "../utils/config.ts";
import { formatDuration } from "../../lib.ts";
import { getSuperpowersStatusDetails, renderSuperpowersStatus } from "../superpowers.ts";
import { approvalTaskSummaries } from "../utils/task-format.ts";
import * as store from "../store.ts";
import * as teamStore from "../team/store.ts";
import { autonomousState, getPlanningUpdateAgeMs, isAutonomousForCwd, isPlanningForCwd, isPlanningStalled, planningState, PLANNING_STALE_TIMEOUT_MS } from "../state.ts";

function getTeamStatusDetails(cwd: string) {
  const active = teamStore.getActiveTeam(cwd);
  const profile = teamStore.loadActiveProfile(cwd);
  return {
    active: active ? { name: active.name, profile: active.profile } : null,
    profile: profile?.name ?? active?.profile ?? null,
    charterPresent: !!teamStore.readCharter(cwd),
    activeRoles: Object.keys(profile?.roles ?? {}).sort(),
    memoryCounts: teamStore.memoryCounts(cwd),
    needsLead: teamStore.needsLeadTasks(cwd).map(task => ({
      id: task.id,
      title: task.title,
      approval: task.approval,
    })),
    rejected: teamStore.rejectedTasks(cwd).map(task => ({
      id: task.id,
      title: task.title,
      approval: task.approval,
    })),
  };
}

function renderTeamStatus(details: ReturnType<typeof getTeamStatusDetails>): string {
  if (!details.active) return "Team: inactive";
  return [
    `Team: ${details.active.name}`,
    `Profile: ${details.profile ?? "(none)"}`,
    `Active roles: ${details.activeRoles.length > 0 ? details.activeRoles.join(", ") : "none"}`,
    `Needs lead: ${details.needsLead.length}`,
    `Rejected: ${details.rejected.length}`,
  ].join("\n");
}

/**
 * Execute status action - shows plan progress.
 */
export async function execute(ctx: ExtensionContext) {
  const cwd = ctx.cwd;
  const plan = store.getPlan(cwd);
  const teamDetails = getTeamStatusDetails(cwd);
  const teamText = renderTeamStatus(teamDetails);
  const superpowersText = renderSuperpowersStatus();
  const superpowersDetails = getSuperpowersStatusDetails();

  if (!plan) {
    return result(`# Crew Status

**No active plan.**

Create a plan:
  pi_messenger({ action: "plan" })                                        # Auto-discovers PRD.md
  pi_messenger({ action: "plan", prd: "docs/PRD.md" })                    # Explicit PRD path
  pi_messenger({ action: "plan", prompt: "Scan the codebase for bugs" })   # Inline prompt

## Team
${teamText}

## Superpowers
${superpowersText}`, {
      mode: "status",
      hasPlan: false,
      team: teamDetails,
      superpowers: superpowersDetails
    });
  }

  const tasks = store.getTasks(cwd);
  const config = loadCrewConfig(store.getCrewDir(cwd));
  const done = tasks.filter(t => t.status === "done");
  const inProgress = tasks.filter(t => t.status === "in_progress");
  const blocked = tasks.filter(t => t.status === "blocked");
  const available = store.getReadyTasks(cwd, { advisory: config.dependencies === "advisory" });
  const ready: typeof available = [];
  const needsApproval: typeof available = [];
  const rejected: typeof available = [];
  for (const task of available) {
    if (teamStore.taskNeedsRevision(task)) rejected.push(task);
    else if (teamStore.taskPendingApproval(task)) needsApproval.push(task);
    else ready.push(task);
  }
  const waiting = tasks.filter(t =>
    t.status === "todo" && !available.some(r => r.id === t.id)
  );

  const pct = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;
  const autonomousActive = isAutonomousForCwd(cwd);

  let text = `# Crew Status

**Plan:** ${store.getPlanLabel(plan)}
**Progress:** ${done.length}/${tasks.length} tasks (${pct}%)
`;

  if (tasks.length === 0 && isPlanningForCwd(cwd)) {
    const stalled = isPlanningStalled(cwd);
    const ageMs = getPlanningUpdateAgeMs(cwd);
    text += `
**Planning:** pass ${planningState.pass}/${planningState.maxPasses} — ${planningState.phase}`;
    if (planningState.updatedAt) {
      text += `\n**Last update:** ${planningState.updatedAt}`;
    }
    if (stalled) {
      const ageLabel = ageMs === null ? "unknown" : formatDuration(ageMs);
      text += `\n**Planning health:** stalled (no updates for ${ageLabel}; timeout ${formatDuration(PLANNING_STALE_TIMEOUT_MS)})`;
    } else {
      text += `\n**Planning health:** active`;
    }
    text += `\n**Progress log:** .pi/messenger/crew/planning-progress.md`;
    text += `\n**Outline:** .pi/messenger/crew/planning-outline.md`;
  }

  text += `\n\n## Tasks\n`;

  if (done.length > 0) {
    text += `\n✅ **Done**\n`;
    for (const t of done) {
      text += `  - ${t.id}: ${t.title}\n`;
    }
  }

  if (inProgress.length > 0) {
    text += `\n🔄 **In Progress**\n`;
    for (const t of inProgress) {
      const parts: string[] = [];
      if (t.assigned_to) parts.push(t.assigned_to);
      if (t.attempt_count > 1) parts.push(`attempt ${t.attempt_count}`);
      const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      text += `  - ${t.id}: ${t.title}${suffix}\n`;
    }
  }

  if (config.dependencies === "advisory") {
    if (ready.length > 0) {
      text += `\n⬜ **Available**\n`;
      for (const t of ready) {
        let depSuffix = "";
        if (t.depends_on.length > 0) {
          const depStatus = t.depends_on.map(depId => {
            const dep = store.getTask(cwd, depId);
            if (!dep) return `${depId} ○`;
            if (dep.status === "done") return `${depId} ✓`;
            if (dep.status === "in_progress") return `${depId} ⟳`;
            return `${depId} ○`;
          }).join(", ");
          depSuffix = ` (needs: ${depStatus})`;
        }
        text += `  - ${t.id}: ${t.title}${depSuffix}\n`;
      }
    }
  } else {
    if (ready.length > 0) {
      text += `\n⬜ **Ready**\n`;
      for (const t of ready) {
        text += `  - ${t.id}: ${t.title}\n`;
      }
    }

    if (waiting.length > 0) {
      text += `\n⏸️ **Waiting** (dependencies not met)\n`;
      for (const t of waiting) {
        const deps = t.depends_on.join(", ");
        text += `  - ${t.id}: ${t.title} → needs: ${deps}\n`;
      }
    }
  }

  if (needsApproval.length > 0) {
    text += `\nNeeds approval:\n`;
    for (const t of needsApproval) {
      text += `  - ${t.id}: ${t.title}\n`;
      text += `    Approve with: \`pi_messenger({ action: "task.approve", id: "${t.id}" })\`\n`;
    }
  }

  if (rejected.length > 0) {
    text += `\nRejected tasks need revision:\n`;
    for (const t of rejected) {
      const feedback = t.approval?.feedback ? ` — ${t.approval.feedback}` : "";
      text += `  - ${t.id}: ${t.title}${feedback}\n`;
      text += `    Revise with: \`pi_messenger({ action: "task.revise", id: "${t.id}", prompt: "Address approval feedback" })\`\n`;
    }
  }

  if (blocked.length > 0) {
    text += `\n🚫 **Blocked**\n`;
    for (const t of blocked) {
      const reason = t.blocked_reason
        ? ` (${t.blocked_reason.length > 40 ? t.blocked_reason.slice(0, 40) + "..." : t.blocked_reason})`
        : "";
      text += `  - ${t.id}: ${t.title}${reason}\n`;
    }
  }

  // Add autonomous status if active for this project
  if (autonomousActive) {
    text += `\n## Autonomous Mode\n`;
    text += `Wave ${autonomousState.waveNumber} running...\n`;
    if (autonomousState.startedAt) {
      const startTime = new Date(autonomousState.startedAt).getTime();
      const elapsedMs = Date.now() - startTime;
      const minutes = Math.floor(elapsedMs / 60000);
      const seconds = Math.floor((elapsedMs % 60000) / 1000);
      text += `Elapsed: ${minutes}:${seconds.toString().padStart(2, "0")}\n`;
    }
  }

  text += `\n## Next`;
  if (tasks.length === 0 && isPlanningForCwd(cwd)) {
    text += `\nPlanning is in progress. Check .pi/messenger/crew/planning-progress.md for updates.`;
  } else if (tasks.length === 0) {
    text += `\nNo tasks yet. Run \`pi_messenger({ action: "plan" })\` to generate tasks from your PRD.`;
  } else if (done.length === tasks.length) {
    text += `\n🎉 All tasks complete!`;
  } else if (ready.length > 0) {
    text += `\nRun \`pi_messenger({ action: "work" })\` to execute ${ready.map(t => t.id).join(", ")}`;
  } else if (rejected.length > 0) {
    text += `\nRevise rejected tasks using the guidance above.`;
  } else if (needsApproval.length > 0) {
    text += `\nApprove pending tasks using the guidance above.`;
  } else if (blocked.length > 0) {
    text += `\nUnblock tasks with \`pi_messenger({ action: "task.unblock", id: "..." })\``;
  } else if (inProgress.length > 0) {
    text += `\nWaiting for in-progress tasks to complete.`;
  }

  text += `\n\n## Team\n${teamText}`;
  text += `\n\n## Superpowers\n${superpowersText}`;

  return result(text, {
    mode: "status",
    hasPlan: true,
    team: teamDetails,
    prd: plan.prd,
    progress: { done: done.length, total: tasks.length, pct },
    tasks: {
      done: done.map(t => t.id),
      inProgress: inProgress.map(t => t.id),
      ready: ready.map(t => t.id),
      needsApproval: approvalTaskSummaries(needsApproval),
      rejected: approvalTaskSummaries(rejected),
      waiting: waiting.map(t => t.id),
      blocked: blocked.map(t => t.id)
    },
    planning: {
      active: isPlanningForCwd(cwd),
      pass: planningState.pass,
      maxPasses: planningState.maxPasses,
      phase: planningState.phase,
      updatedAt: planningState.updatedAt,
      stale: isPlanningStalled(cwd),
      ageMs: getPlanningUpdateAgeMs(cwd),
      staleAfterMs: PLANNING_STALE_TIMEOUT_MS,
    },
    autonomous: autonomousActive,
    superpowers: superpowersDetails
  });
}

/**
 * Execute crew.* actions (crew.status, crew.agents, crew.install, crew.uninstall)
 */
export async function executeCrew(
  op: string,
  ctx: ExtensionContext
) {
  const cwd = ctx.cwd;

  switch (op) {
    case "status": {
      return execute(ctx);
    }

    case "agents": {
      const agents = discoverCrewAgents(cwd);
      if (agents.length === 0) {
        return result("No crew agents found. Check extension installation.", {
          mode: "crew.agents",
          agents: []
        });
      }

      const byRole: Record<string, string[]> = {};
      for (const a of agents) {
        const role = a.crewRole ?? "other";
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(`${a.name} (${a.model ?? "default"})`);
      }

      let text = "# Crew Agents\n";
      for (const [role, names] of Object.entries(byRole)) {
        text += `\n**${role}s:** ${names.join(", ")}\n`;
      }

      return result(text, {
        mode: "crew.agents",
        agents: agents.map(a => ({ name: a.name, role: a.crewRole, model: a.model }))
      });
    }

    case "install": {
      const agents = discoverCrewAgents(cwd);
      return result(`Crew agents (${agents.length}): ${agents.map(a => `${a.name} (${a.source})`).join(", ")}`, {
        mode: "crew.install",
        agents: agents.map(a => ({ name: a.name, source: a.source })),
      });
    }

    case "uninstall": {
      const agentResult = uninstallAgents();
      
      if (agentResult.errors.length > 0) {
        return result(`⚠️ Removed with ${agentResult.errors.length} error(s):\n${agentResult.errors.join("\n")}`, {
          mode: "crew.uninstall",
          removed: agentResult.removed,
          errors: agentResult.errors
        });
      }
      return result(`✅ Removed ${agentResult.removed.length} agent(s)`, {
        mode: "crew.uninstall",
        removed: agentResult.removed,
      });
    }

    case "validate": {
      const validation = store.validatePlan(cwd);
      
      if (validation.valid && validation.warnings.length === 0) {
        return result("✅ Plan is valid with no warnings.", {
          mode: "crew.validate",
          valid: true,
          errors: [],
          warnings: []
        });
      }

      let text = validation.valid ? "✅ Plan is valid" : "❌ Plan has errors";
      
      if (validation.errors.length > 0) {
        text += "\n\n**Errors:**\n" + validation.errors.map(e => `- ${e}`).join("\n");
      }
      
      if (validation.warnings.length > 0) {
        text += "\n\n**Warnings:**\n" + validation.warnings.map(w => `- ${w}`).join("\n");
      }

      return result(text, {
        mode: "crew.validate",
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    default:
      return result(`Unknown crew operation: ${op}`, {
        mode: "crew",
        error: "unknown_operation",
        operation: op
      });
  }
}

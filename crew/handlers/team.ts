import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { MessengerState } from "../../lib.js";
import type { CrewParams } from "../types.js";
import { result } from "../utils/result.js";
import * as crewStore from "../store.js";
import * as teamStore from "../team/store.js";
import { TEAM_MEMORY_TYPES, type TeamMemoryType, type TeamProfile } from "../team/types.js";

export async function execute(op: string, params: CrewParams, state: MessengerState, ctx: ExtensionContext) {
  const cwd = ctx.cwd ?? process.cwd();

  switch (op) {
    case "profile.list":
      return profileList();
    case "profile.use":
      return profileUse(cwd, params);
    case "profile.save":
      return profileSave(cwd, params);
    case "charter.show":
      return charterShow(cwd);
    case "charter.create":
      return charterCreate(cwd, params);
    case "charter.update":
      return charterUpdate(cwd, params);
    case "memory.note":
      return memoryNote(cwd, params, state);
    case "memory.list":
      return memoryList(cwd, params);
    case "roles":
      return roles(cwd);
    case "status":
      return status(cwd);
    default:
      return result(`Unknown team operation: ${op}`, { mode: "team", error: "unknown_operation", operation: op });
  }
}

function memoryType(value: unknown): TeamMemoryType | null {
  return typeof value === "string" && TEAM_MEMORY_TYPES.includes(value as TeamMemoryType) ? value as TeamMemoryType : null;
}

function profileList() {
  const profiles = teamStore.listProfiles();
  const text = `# Team Profiles\n\n${profiles.map(p => `- ${p.name}${p.description ? ` — ${p.description}` : ""}`).join("\n")}`;
  return result(text, { mode: "team.profile.list", profiles });
}

function profileUse(cwd: string, params: CrewParams) {
  if (!params.name) return result("Error: name required for team.profile.use", { mode: "team.profile.use", error: "missing_name" });
  if (!teamStore.isValidProfileName(params.name)) {
    return result("Error: invalid team profile name. Use letters, numbers, underscore, or hyphen.", { mode: "team.profile.use", error: "invalid_name" });
  }
  const { team, profile, created } = teamStore.useProfile(cwd, params.name);
  const action = created ? "Created and activated" : "Activated";
  return result(`${action} team profile **${profile.name}**.`, {
    mode: "team.profile.use",
    team,
    profile,
    created,
  });
}

function profileSave(cwd: string, params: CrewParams) {
  if (!params.name) return result("Error: name required for team.profile.save", { mode: "team.profile.save", error: "missing_name" });
  if (!teamStore.isValidProfileName(params.name)) {
    return result("Error: invalid team profile name. Use letters, numbers, underscore, or hyphen.", { mode: "team.profile.save", error: "invalid_name" });
  }
  const active = teamStore.getActiveTeam(cwd);
  const activeProfile = teamStore.loadActiveProfile(cwd);
  const profile: TeamProfile = {
    ...(activeProfile ?? teamStore.defaultTeamProfile(params.name)),
    name: params.name,
  };
  teamStore.saveProfile(profile);
  const team = teamStore.setActiveTeam(cwd, active?.name ?? params.name, profile.name);
  return result(`Saved team profile **${profile.name}**.`, { mode: "team.profile.save", team, profile });
}

function charterShow(cwd: string) {
  const charter = teamStore.readCharter(cwd);
  if (!charter) {
    return result("No team charter found. Create one with `team.charter.create`.", {
      mode: "team.charter.show",
      charter: null,
      exists: false,
    });
  }
  return result(charter, {
    mode: "team.charter.show",
    charter,
    exists: true,
  });
}

function charterCreate(cwd: string, params: CrewParams) {
  if (!params.name) return result("Error: name required for team.charter.create", { mode: "team.charter.create", error: "missing_name" });
  if (!params.message) return result("Error: message required for team.charter.create", { mode: "team.charter.create", error: "missing_message" });
  const charter = teamStore.writeCharter(cwd, params.name, params.message);
  return result(`Created charter for **${params.name}**.`, { mode: "team.charter.create", charter, team: teamStore.getActiveTeam(cwd) });
}

function charterUpdate(cwd: string, params: CrewParams) {
  if (!params.message) return result("Error: message required for team.charter.update", { mode: "team.charter.update", error: "missing_message" });
  const charter = teamStore.updateCharter(cwd, params.message);
  return result("Updated team charter.", { mode: "team.charter.update", charter, team: teamStore.getActiveTeam(cwd) });
}

function memoryNote(cwd: string, params: CrewParams, state: MessengerState) {
  const type = memoryType(params.type);
  if (!type) return result("Error: type must be one of decision, interface, risk, or handoff", { mode: "team.memory.note", error: "invalid_type" });
  if (!params.message) return result("Error: message required for team.memory.note", { mode: "team.memory.note", error: "missing_message" });
  const entry = teamStore.noteMemory(cwd, type, params.message, state.agentName || "unknown", params.id);
  return result(`Saved team ${type} note.`, { mode: "team.memory.note", entry });
}

function memoryList(cwd: string, params: CrewParams) {
  const type = params.type ? memoryType(params.type) : null;
  if (params.type && !type) return result("Error: type must be one of decision, interface, risk, or handoff", { mode: "team.memory.list", error: "invalid_type" });
  const entries = teamStore.listMemory(cwd, type ?? undefined, params.limit);
  const text = entries.length > 0
    ? entries.map(entry => `- ${entry.ts} [${entry.type}] ${entry.message}${entry.taskId ? ` (${entry.taskId})` : ""}`).join("\n")
    : "No team memory entries found.";
  return result(text, { mode: "team.memory.list", type, entries });
}

function roles(cwd: string) {
  const roles = teamStore.resolveRoles(cwd);
  const profile = teamStore.loadActiveProfile(cwd);
  const activeNames = Object.keys(profile?.roles ?? {}).sort();
  const builtInNames = Object.keys(roles).filter(name => !activeNames.includes(name)).sort();
  const formatRole = (name: string) => {
    const role = roles[name];
    return `- ${name}${role?.description ? ` — ${role.description}` : ""}`;
  };
  const activeText = activeNames.length > 0
    ? `## Active profile roles\n${activeNames.map(formatRole).join("\n")}`
    : "## Active profile roles\nNo Team profile is active.";
  const availableText = builtInNames.length > 0
    ? `\n\n## Other available roles\n${builtInNames.map(formatRole).join("\n")}`
    : "";
  const note = "Team roles are labels and prompt context. Crew still runs tasks through Crew agents and does not launch pi-subagents.";
  return result(`# Team Roles\n\n${note}\n\n${activeText}${availableText}`, {
    mode: "team.roles",
    activeRoles: activeNames,
    availableRoles: builtInNames,
    roles,
  });
}

function status(cwd: string) {
  const team = teamStore.getActiveTeam(cwd);
  const profile = teamStore.loadActiveProfile(cwd);
  const charter = teamStore.readCharter(cwd);
  const roles = teamStore.resolveRoles(cwd);
  const roleNames = Object.keys(roles).sort();
  const activeRoleNames = Object.keys(profile?.roles ?? {}).sort();
  const counts = teamStore.memoryCounts(cwd);
  const needsLead = teamStore.needsLeadTasks(cwd);
  const approvalText = needsLead.length > 0
    ? `\nNeeds approval:\n${needsLead.map(t => `- ${t.id}: ${t.title} [${t.approval?.status ?? "pending"}]`).join("\n")}`
    : "\nNeeds approval: none";
  const nextAction = needsLead.length > 0
    ? `Approve with: pi_messenger({ action: "task.approve", id: "${needsLead[0].id}" })`
    : team ? "Next: plan or run Crew work with this Team context." : "Next: activate a sample profile, e.g. migration-squad, review-squad, or research-squad.";
  const text = `Team: ${team?.name ?? "(none)"}\nProfile: ${profile?.name ?? team?.profile ?? "(none)"}\nCharter: ${charter ? "present" : "missing"}\nActive roles: ${activeRoleNames.length > 0 ? activeRoleNames.join(", ") : "none"}\nMemory: decisions ${counts.decision}, interfaces ${counts.interface}, risks ${counts.risk}, handoffs ${counts.handoff}${approvalText}\n${nextAction}`;
  return result(text, {
    mode: "team.status",
    team,
    profile,
    charterPresent: !!charter,
    roles: roleNames,
    activeRoles: activeRoleNames,
    nextAction,
    memoryCounts: counts,
    needsLead: needsLead.map(t => ({ id: t.id, title: t.title, approval: t.approval })),
    taskCount: crewStore.getTasks(cwd).length,
  });
}

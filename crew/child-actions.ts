type CrewChildRole = "planner" | "reviewer" | "analyst" | "worker";

const CHILD_ROLES = new Set<CrewChildRole>([
	"planner",
	"reviewer",
	"analyst",
	"worker",
]);

const SHARED_CHILD_ACTIONS = new Set([
	"join",
	"status",
	"list",
	"whois",
	"feed",
	"set_status",
	"send",
	"broadcast",
	"task.show",
	"task.list",
	"task.ready",
	"crew.status",
	"crew.agents",
]);

const WORKER_ACTIONS = new Set([
	"reserve",
	"release",
	"task.start",
	"task.progress",
	"task.done",
	"task.block",
]);

function getCrewChildRole(): CrewChildRole | undefined {
	const configured = process.env.PI_CREW_ROLE;
	if (configured && CHILD_ROLES.has(configured as CrewChildRole)) {
		return configured as CrewChildRole;
	}
	if (process.env.PI_CREW_WORKER === "1" || process.env.PI_LOBBY_ID) {
		return "worker";
	}
	return undefined;
}

export function isCrewChildActionAllowed(
	action: string,
	role: CrewChildRole | undefined = getCrewChildRole(),
): boolean {
	if (!role || !CHILD_ROLES.has(role)) return false;
	if (SHARED_CHILD_ACTIONS.has(action)) return true;
	return role === "worker" && WORKER_ACTIONS.has(action);
}

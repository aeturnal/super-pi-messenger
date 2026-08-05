const CHILD_ACTIONS = new Set([
  "status", "list", "whois", "feed", "send", "broadcast",
  "reserve", "release", "task.show", "task.list", "task.ready",
  "task.progress", "task.done", "crew.status", "crew.agents",
]);

export function isCrewChildActionAllowed(action: string): boolean {
  return CHILD_ACTIONS.has(action);
}

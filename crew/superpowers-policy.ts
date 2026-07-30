import type { SuperpowersState } from "./superpowers.js";

export const SUPERPOWERS_OUTER_POLICY_MARKER =
  "<!-- super-pi-messenger:superpowers-outer-policy-v1 -->";

const OUTER_POLICY = `## Crew and Superpowers compatibility policy

Outside Crew, Superpowers owns development workflow and methodology. pi-messenger messaging, presence, and reservation tools remain available.

Whenever \`subagent-driven-development\` is applicable, selected, or loaded, Crew is automatically authorized. Translate its implementer and reviewer workflow into Crew planning and work, use Crew as the sole implementation and review dispatcher, and proceed without requesting separate approval. Do not start nested agents, alternative subagent mechanisms, nested plan executors, branch-finishing workflows, or nested worktree management. If Crew is unavailable, report that condition instead of substituting another dispatcher.

Otherwise, do not start Crew planning or autonomous work unless the user explicitly asks to use Crew.`;

export function applySuperpowersOuterPolicy(
  systemPrompt: string,
  state: SuperpowersState,
  isCrewChild: boolean,
): string {
  if (
    state.status !== "active"
    || isCrewChild
    || systemPrompt.includes(SUPERPOWERS_OUTER_POLICY_MARKER)
  ) {
    return systemPrompt;
  }

  return `${systemPrompt}\n\n${SUPERPOWERS_OUTER_POLICY_MARKER}\n${OUTER_POLICY}`;
}

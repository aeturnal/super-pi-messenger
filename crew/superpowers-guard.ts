import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUPERPOWERS_CHILD_FLAG = "PI_CREW_SUPERPOWERS_MVP";
export const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
export const LEGACY_POLICY_MARKER = "<!-- crew-superpowers-policy:";

export function stripStockBootstrap(messages: unknown[]): unknown[] {
  return messages.filter((message) => {
    if (typeof message !== "object" || message === null) return true;

    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return !content.includes(STOCK_BOOTSTRAP_MARKER);
    if (!Array.isArray(content)) return true;

    return !content.some((part) =>
      typeof part === "object"
        && part !== null
        && (part as { type?: unknown }).type === "text"
        && typeof (part as { text?: unknown }).text === "string"
        && (part as { text: string }).text.includes(STOCK_BOOTSTRAP_MARKER)
    );
  });
}

export function stripLegacyPolicy(systemPrompt: string): string {
  const markerIndex = systemPrompt.indexOf(LEGACY_POLICY_MARKER);
  return markerIndex === -1 ? systemPrompt : systemPrompt.slice(0, markerIndex);
}

export default function registerSuperpowersGuard(pi: ExtensionAPI): void {
  const role = process.env.PI_CREW_ROLE;
  if (
    process.env[SUPERPOWERS_CHILD_FLAG] !== "1"
    || (role !== "worker" && role !== "reviewer")
  ) return;

  pi.on("before_agent_start", (event) => ({
    systemPrompt: stripLegacyPolicy(event.systemPrompt),
  }));
  pi.on("context", (event) => ({
    messages: stripStockBootstrap(event.messages),
  }));
}

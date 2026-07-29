import type { CrewAgentConfig } from "../utils/discover.js";

function isExtensionPath(tool: string): boolean {
  return tool.includes("/")
    || tool.includes("\\")
    || /\.[cm]?[jt]s$/i.test(tool);
}

export function buildPiToolArgs(
  agentConfig: Pick<CrewAgentConfig, "tools"> | undefined,
  extensionDir: string,
): string[] {
  const namedTools: string[] = [];
  const extensionPaths: string[] = [];

  for (const tool of agentConfig?.tools ?? []) {
    if (isExtensionPath(tool)) extensionPaths.push(tool);
    else namedTools.push(tool);
  }

  const args: string[] = [];
  if (namedTools.length > 0) args.push("--tools", namedTools.join(","));
  for (const extensionPath of extensionPaths) args.push("--extension", extensionPath);
  args.push("--extension", extensionDir);
  return args;
}

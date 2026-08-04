import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export function createMockContext(cwd: string = process.cwd()): ExtensionContext {
  return {
    hasUI: true,
    cwd,
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
      },
      notify: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn(),
    } as unknown as ExtensionContext["ui"],
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => "test-session",
    } as unknown as ExtensionContext["sessionManager"],
    model: { provider: "test-provider", id: "test-model" },
  } as unknown as ExtensionContext;
}

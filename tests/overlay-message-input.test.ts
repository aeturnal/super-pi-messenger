import { afterEach, describe, expect, it, vi } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import type { Dirs, MessengerState } from "../lib.ts";

const getActiveAgents = vi.hoisted(() => vi.fn());
const sendMessageToAgent = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-tui", () => ({
	matchesKey: (data: string, key: string) => key === "enter" && data === "\r",
	truncateToWidth: (text: string) => text,
}));

vi.mock("../store.ts", () => ({
	getActiveAgents,
	sendMessageToAgent,
}));

vi.mock("../feed.ts", () => ({
	logFeedEvent: vi.fn(),
}));

vi.mock("../crew/live-progress.ts", () => ({
	getLiveWorkers: () => new Map(),
}));

vi.mock("../crew/registry.ts", () => ({
	hasActiveWorker: () => false,
}));

import {
	createCrewViewState,
	handleMessageInput,
	type CrewViewState,
} from "../overlay-actions.ts";
import { renderLegend } from "../overlay-render.ts";

const theme = { fg: (_color: string, text: string) => text } as any;
const dirs = {
	base: "/tmp",
	registry: "/tmp/registry",
	inbox: "/tmp/inbox",
} as Dirs;
const state = {
	agentName: "me",
	chatHistory: new Map(),
	broadcastHistory: [],
} as unknown as MessengerState;

const viewStates: CrewViewState[] = [];

afterEach(() => {
	for (const viewState of viewStates.splice(0)) {
		if (viewState.notificationTimer) clearTimeout(viewState.notificationTimer);
	}
	vi.clearAllMocks();
});

function makeViewState(input: string): CrewViewState {
	const viewState = createCrewViewState();
	viewState.inputMode = "message";
	viewState.messageInput = input;
	viewStates.push(viewState);
	return viewState;
}

function makeTui(): TUI {
	return { requestRender: vi.fn() } as unknown as TUI;
}

function legend(viewState: CrewViewState): string {
	return renderLegend(theme, "/tmp/cwd", 200, viewState, null);
}

describe("overlay message input", () => {
	it("renders a malformed direct-message error without clearing the composer", () => {
		const viewState = makeViewState("@target");

		handleMessageInput("\r", viewState, state, dirs, "/tmp/cwd", makeTui());

		expect(viewState.inputMode).toBe("message");
		expect(viewState.messageInput).toBe("@target");
		expect(legend(viewState)).toContain(
			"Use @name <message> or type to broadcast",
		);
		expect(legend(viewState)).toContain("DM: @target█");
	});

	it("renders a no-peer broadcast error without clearing the composer", () => {
		getActiveAgents.mockReturnValue([]);
		const viewState = makeViewState("hello peers");

		handleMessageInput("\r", viewState, state, dirs, "/tmp/cwd", makeTui());

		expect(viewState.inputMode).toBe("message");
		expect(viewState.messageInput).toBe("hello peers");
		expect(legend(viewState)).toContain("No peers available for @all");
		expect(legend(viewState)).toContain("broadcast: hello peers█");
	});

	it("clears the composer after a successful direct message", () => {
		sendMessageToAgent.mockReturnValue({ id: "message-1" });
		const viewState = makeViewState("@target hello");

		handleMessageInput("\r", viewState, state, dirs, "/tmp/cwd", makeTui());

		expect(viewState.inputMode).toBe("normal");
		expect(viewState.messageInput).toBe("");
	});

	it("clears the composer after a successful broadcast", () => {
		getActiveAgents.mockReturnValue([{ name: "target" }]);
		sendMessageToAgent.mockReturnValue({ id: "message-1" });
		const viewState = makeViewState("hello peers");

		handleMessageInput("\r", viewState, state, dirs, "/tmp/cwd", makeTui());

		expect(viewState.inputMode).toBe("normal");
		expect(viewState.messageInput).toBe("");
	});

	it("removes an expired notification without clearing the composer", () => {
		const viewState = makeViewState("still drafting");
		viewState.notification = {
			message: "✗ expired error",
			expiresAt: Date.now() - 1,
		};

		expect(legend(viewState)).toContain("broadcast: still drafting█");
		expect(viewState.notification).toBeNull();
		expect(viewState.messageInput).toBe("still drafting");
	});
});

import { describe, expect, it } from "vitest";
import { createTempCrewDirs } from "../helpers/temp-dirs.js";
import * as store from "../../crew/store.js";
import * as teamStore from "../../crew/team/store.js";
import { renderStatusBar, renderTaskList } from "../../overlay-render.js";
import { createCrewViewState } from "../../overlay-actions.js";

const theme = { fg: (_color: string, text: string) => text } as any;

describe("Team overlay render signals", () => {
  it("shows active team, needs-lead count, role labels, and approval markers", () => {
    const { cwd } = createTempCrewDirs();
    teamStore.setActiveTeam(cwd, "migration-squad", "migration-squad");
    store.createPlan(cwd, "docs/PRD.md");
    store.createTask(cwd, "Update auth", "", [], {
      role: "worker",
      approval: { required: true, status: "rejected" },
    });

    const status = renderStatusBar(theme, cwd, 200);
    const tasks = renderTaskList(theme, cwd, 200, 10, createCrewViewState()).join("\n");

    expect(status).toContain("Team: migration-squad");
    expect(status).toContain("Needs lead: 1");
    expect(tasks).toContain("[worker]");
    expect(tasks).toContain("[rejected]");
  });
});

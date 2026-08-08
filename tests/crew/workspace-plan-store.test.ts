import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as store from "../../crew/store.ts";
import type { WorkspaceIdentity } from "../../crew/types.ts";
import { createTempCrewDirs } from "../helpers/temp-dirs.ts";

describe("workspace plan persistence", () => {
  const identity: WorkspaceIdentity = {
    root: "/repo/.worktrees/feature",
    gitDir: "/repo/.git/worktrees/feature",
    gitCommonDir: "/repo/.git",
  };

  it("persists a supplied workspace identity", () => {
    const { cwd, crewDir } = createTempCrewDirs();

    const plan = store.createPlan(cwd, "docs/plan.md", undefined, identity);

    expect(plan.workspace).toEqual(identity);
    expect(store.getPlan(cwd)?.workspace).toEqual(identity);
    expect(JSON.parse(fs.readFileSync(path.join(crewDir, "plan.json"), "utf-8"))).toMatchObject({
      workspace: identity,
    });
  });

  it("keeps three-argument plans without a workspace", () => {
    const { cwd, crewDir } = createTempCrewDirs();

    const plan = store.createPlan(cwd, "docs/plan.md", "Plan work");

    expect(plan).not.toHaveProperty("workspace");
    expect(store.getPlan(cwd)).toEqual(plan);
    expect(JSON.parse(fs.readFileSync(path.join(crewDir, "plan.json"), "utf-8"))).not.toHaveProperty("workspace");
  });
});

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSuperpowersSkills,
  getSuperpowersState,
  getSuperpowersStatusDetails,
  prepareSuperpowersLaunch,
  renderSuperpowersGuidance,
  renderSuperpowersStatus,
  resetSuperpowersStateForTests,
  takeSuperpowersWarning,
} from "../../crew/superpowers.js";
import {
  createStockSuperpowersFixture,
  type StockSuperpowersFixture,
} from "../helpers/superpowers.js";

describe("Superpowers package validation", () => {
  const cleanups: Array<() => void> = [];

  function track(fixture: StockSuperpowersFixture): StockSuperpowersFixture {
    cleanups.push(fixture.cleanup);
    return fixture;
  }

  function asRuntimeDiscoveredSkills(
    fixture: StockSuperpowersFixture,
    origin = "https://github.com/obra/superpowers",
  ): Skill[] {
    execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", origin], {
      cwd: fixture.root,
      stdio: "ignore",
    });
    const extensionDir = path.join(fixture.root, ".pi", "extensions");
    return fixture.skills.map((skill) => ({
      ...skill,
      baseDir: path.dirname(skill.filePath),
      sourceInfo: {
        path: skill.filePath,
        source: "extension:superpowers",
        scope: "temporary",
        origin: "top-level",
        baseDir: extensionDir,
      },
    }));
  }

  beforeEach(resetSuperpowersStateForTests);
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("renders compact inactive status without a warning", () => {
    expect(renderSuperpowersStatus()).toBe("Superpowers integration: inactive");
    expect(renderSuperpowersStatus()).not.toContain("⚠");
    expect(renderSuperpowersStatus().length).toBeLessThan(80);
    expect(getSuperpowersStatusDetails()).toEqual({ status: "inactive" });
  });

  it("is inactive and silent when Superpowers is absent", () => {
    const unrelatedSkill = {
      name: "unrelated-skill",
      description: "An unrelated installed Pi skill",
      filePath: "/tmp/unrelated-skill/SKILL.md",
      baseDir: "/tmp/unrelated-skill",
      sourceInfo: {
        path: "/tmp/unrelated-skill/SKILL.md",
        source: "git:github.com/example/unrelated-skill",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/unrelated-skill",
      },
      disableModelInvocation: false,
    } satisfies Skill;

    expect(captureSuperpowersSkills([])).toEqual({ status: "inactive" });
    expect(captureSuperpowersSkills([unrelatedSkill])).toEqual({ status: "inactive" });
    expect(getSuperpowersState()).toEqual({ status: "inactive" });
  });

  it("falls back for an untrusted using-superpowers package candidate", () => {
    const candidate = {
      name: "using-superpowers",
      description: "Bootstrap Superpowers workflows",
      filePath: "/tmp/superpowers/skills/using-superpowers/SKILL.md",
      baseDir: "/tmp/superpowers",
      sourceInfo: {
        path: "/tmp/superpowers/skills/using-superpowers/SKILL.md",
        source: "git:github.com/example/superpowers",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/superpowers",
      },
      disableModelInvocation: true,
    } satisfies Skill;

    expect(captureSuperpowersSkills([candidate])).toEqual({
      status: "fallback",
      reason: expect.stringContaining("official Superpowers provenance"),
      correctiveAction: "Install Superpowers from github.com/obra/superpowers.",
    });
  });

  it("ignores an unrelated skill with official-source metadata", () => {
    const unrelatedSkill = {
      name: "unrelated-skill",
      description: "An unrelated skill from the official package",
      filePath: "/tmp/unrelated-skill/SKILL.md",
      baseDir: "/tmp/unrelated-skill",
      sourceInfo: {
        path: "/tmp/unrelated-skill/SKILL.md",
        source: "git:github.com/obra/superpowers",
        scope: "user",
        origin: "package",
        baseDir: "/tmp/unrelated-skill",
      },
      disableModelInvocation: false,
    } satisfies Skill;

    expect(captureSuperpowersSkills([unrelatedSkill])).toEqual({ status: "inactive" });
  });

  it("accepts one official Git package with the required stock files", () => {
    const fixture = track(createStockSuperpowersFixture());
    expect(captureSuperpowersSkills(fixture.skills)).toMatchObject({
      status: "active",
      version: "6.2.0",
      packageRoot: fs.realpathSync(fixture.root),
    });
  });

  it("accepts stock skills republished by the official runtime extension", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture);

    expect(captureSuperpowersSkills(skills)).toMatchObject({
      status: "active",
      version: "6.2.0",
      packageRoot: fs.realpathSync(fixture.root),
    });
  });

  it("rejects mixed official-package and runtime-discovered candidates with an unofficial origin", () => {
    const fixture = track(createStockSuperpowersFixture());
    const [usingSuperpowers] = fixture.skills;
    if (!usingSuperpowers) throw new Error("fixture is missing using-superpowers");
    const runtimeRequiredSkills = asRuntimeDiscoveredSkills(
      fixture,
      "https://github.com/example/superpowers.git",
    ).filter((skill) => skill.name !== "using-superpowers");

    expect(captureSuperpowersSkills([usingSuperpowers, ...runtimeRequiredSkills])).toMatchObject({
      status: "fallback",
      reason: expect.stringContaining("Git origin"),
    });
  });

  it("rejects a runtime extension label with a revision-like official origin suffix", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(
      fixture,
      "https://github.com/obra/superpowers@evil",
    );

    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it("rejects a runtime extension label with an unofficial Git origin", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(
      fixture,
      "https://github.com/example/superpowers.git",
    );

    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it.each([
    ["scope", { scope: "project" as const }],
    ["origin", { origin: "package" as const }],
    ["source path", { path: "/tmp/not-stock-superpowers/skills/test/SKILL.md" }],
    ["base directory", { baseDir: "/tmp/not-stock-superpowers/.pi/extensions" }],
  ])("rejects runtime-discovered skills with malformed %s metadata", (_label, override) => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture).map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, ...override },
    }));

    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it("rejects a project shadow beside validated runtime-discovered skills", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = asRuntimeDiscoveredSkills(fixture);
    const stockTdd = skills.find((skill) => skill.name === "test-driven-development");
    if (!stockTdd) throw new Error("fixture is missing test-driven-development");
    const shadow: Skill = {
      ...stockTdd,
      filePath: "/tmp/project/test-driven-development/SKILL.md",
      sourceInfo: {
        path: "/tmp/project/test-driven-development/SKILL.md",
        source: "/tmp/project",
        scope: "project",
        origin: "top-level",
        baseDir: "/tmp/project",
      },
    };

    expect(captureSuperpowersSkills([...skills, shadow])).toMatchObject({
      status: "fallback",
      reason: "shadowed",
    });
  });

  it("accepts a local checkout only when Git origin is official", () => {
    const fixture = track(createStockSuperpowersFixture());
    execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:obra/superpowers.git"], { cwd: fixture.root });
    const skills = fixture.skills.map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, source: fixture.root },
    }));
    expect(captureSuperpowersSkills(skills).status).toBe("active");
  });

  it("rejects a local checkout with a fork origin", () => {
    const fixture = track(createStockSuperpowersFixture());
    execFileSync("git", ["init"], { cwd: fixture.root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/example/superpowers.git"], { cwd: fixture.root });
    const skills = fixture.skills.map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, source: fixture.root },
    }));
    expect(captureSuperpowersSkills(skills)).toMatchObject({ status: "fallback" });
  });

  it("falls back when a project skill shadows an official required skill", () => {
    const fixture = track(createStockSuperpowersFixture());
    const skills = fixture.skills.map((skill) => skill.name === "test-driven-development"
      ? {
          ...skill,
          sourceInfo: { ...skill.sourceInfo, origin: "top-level" as const, scope: "project" as const },
        }
      : skill);

    expect(captureSuperpowersSkills(skills)).toMatchObject({
      status: "fallback",
      reason: "shadowed",
    });
  });

  it("falls back when official required skills are ambiguous across roots", () => {
    const first = track(createStockSuperpowersFixture());
    const second = track(createStockSuperpowersFixture());

    expect(captureSuperpowersSkills([...first.skills, ...second.skills])).toMatchObject({
      status: "fallback",
      reason: "ambiguous",
    });
  });

  it("falls back when the same required skill object is repeated", () => {
    const fixture = track(createStockSuperpowersFixture());
    const repeatedSkill = fixture.skills.find(
      (skill) => skill.name === "test-driven-development",
    );
    if (!repeatedSkill) throw new Error("fixture is missing test-driven-development");

    expect(captureSuperpowersSkills([...fixture.skills, repeatedSkill])).toMatchObject({
      status: "fallback",
      reason: "ambiguous",
    });
  });

  it("renders bounded fallback status observationally", () => {
    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    const fallbackState = captureSuperpowersSkills(fixture.skills);

    const expectedText = [
      "Superpowers integration: fallback (7.0.0)",
      "Reason: unsupported Superpowers major version",
      "Action: Reinstall the official Superpowers package.",
    ].join("\n");
    const expectedDetails = {
      status: "fallback",
      reason: "unsupported Superpowers major version",
      correctiveAction: "Reinstall the official Superpowers package.",
      version: "7.0.0",
    };

    expect(renderSuperpowersStatus()).toBe(expectedText);
    expect(renderSuperpowersStatus().length).toBeLessThan(300);
    expect(getSuperpowersStatusDetails()).toEqual(expectedDetails);
    expect(renderSuperpowersStatus()).toBe(expectedText);
    expect(getSuperpowersStatusDetails()).toEqual(expectedDetails);
    expect(getSuperpowersState()).toBe(fallbackState);
  });

  it.each([
    [{ version: "invalid" }, "invalid Superpowers version"],
    [{ version: "7.0.0" }, "unsupported Superpowers major version"],
    [{ omitSkill: "test-driven-development" as const }, "test-driven-development"],
    [{ bootstrapMarker: false }, "bootstrap marker"],
  ])("falls back completely for an incomplete package", (options, reason) => {
    const fixture = track(createStockSuperpowersFixture(options));
    expect(captureSuperpowersSkills(fixture.skills)).toMatchObject({
      status: "fallback",
      reason: expect.stringContaining(reason),
    });
  });

  it("renders active mappings and the latest launch without persisting reset state", () => {
    const fixture = track(createStockSuperpowersFixture());
    captureSuperpowersSkills(fixture.skills);
    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeDefined();
    expect(prepareSuperpowersLaunch("planner", "ignored")).toBeUndefined();

    expect(renderSuperpowersStatus()).toBe([
      "Superpowers integration: active (6.2.0)",
      "Worker: test-driven-development, verification-before-completion",
      "Reviewer: verification-before-completion",
      "Last launch: worker task-1",
      "Restrictions: no nested orchestration or nested worktree management",
    ].join("\n"));
    expect(getSuperpowersStatusDetails()).toEqual({
      status: "active",
      version: "6.2.0",
      packageRoot: fs.realpathSync(fixture.root),
      mappings: {
        worker: ["test-driven-development", "verification-before-completion"],
        reviewer: ["verification-before-completion"],
      },
      latestLaunch: {
        role: "worker",
        assignmentId: "task-1",
        selectedSkills: ["test-driven-development", "verification-before-completion"],
      },
    });

    resetSuperpowersStateForTests();
    captureSuperpowersSkills(fixture.skills);
    expect(getSuperpowersStatusDetails()).toMatchObject({
      status: "active",
      latestLaunch: null,
    });
  });

  it("selects fixed skills in role order and preserves the assignment", () => {
    const fixture = track(createStockSuperpowersFixture());
    captureSuperpowersSkills(fixture.skills);

    const worker = prepareSuperpowersLaunch("worker", "task-1");
    expect(worker?.selectedSkills.map((skill) => skill.name)).toEqual([
      "test-driven-development",
      "verification-before-completion",
    ]);
    expect(worker?.assignmentId).toBe("task-1");
    expect(prepareSuperpowersLaunch("reviewer")?.selectedSkills.map((skill) => skill.name)).toEqual([
      "verification-before-completion",
    ]);
    expect(prepareSuperpowersLaunch("planner")).toBeUndefined();
  });

  it("queues one actionable warning for repeated launches in the same fallback", () => {
    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(fixture.skills);

    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();
    const warning = takeSuperpowersWarning();
    expect(warning).toContain("unsupported Superpowers major version");
    expect(warning).toContain("Reinstall the official Superpowers package.");
    expect(warning).toContain("Crew will continue with native launch behavior.");
    expect(takeSuperpowersWarning()).toBeUndefined();

    expect(prepareSuperpowersLaunch("reviewer", "review-1")).toBeUndefined();
    expect(takeSuperpowersWarning()).toBeUndefined();
  });

  it("warns once after capture changes the fallback fingerprint", () => {
    const unsupported = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(unsupported.skills);
    prepareSuperpowersLaunch("worker");
    expect(takeSuperpowersWarning()).toContain("unsupported Superpowers major version");

    const incomplete = track(createStockSuperpowersFixture({ bootstrapMarker: false }));
    captureSuperpowersSkills(incomplete.skills);
    prepareSuperpowersLaunch("worker");
    expect(takeSuperpowersWarning()).toContain("missing Superpowers bootstrap marker");

    captureSuperpowersSkills(incomplete.skills);
    prepareSuperpowersLaunch("worker");
    expect(takeSuperpowersWarning()).toBeUndefined();
  });

  it("does not queue warnings from status rendering or unsupported roles", () => {
    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(fixture.skills);

    renderSuperpowersStatus();
    getSuperpowersStatusDetails();
    prepareSuperpowersLaunch("planner");
    expect(takeSuperpowersWarning()).toBeUndefined();

    prepareSuperpowersLaunch("worker");
    expect(takeSuperpowersWarning()).toContain("unsupported Superpowers major version");
  });

  it("resets the pending warning and last-warned fingerprint", () => {
    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(fixture.skills);
    prepareSuperpowersLaunch("worker");

    resetSuperpowersStateForTests();
    expect(takeSuperpowersWarning()).toBeUndefined();

    captureSuperpowersSkills(fixture.skills);
    prepareSuperpowersLaunch("worker");
    expect(takeSuperpowersWarning()).toContain("unsupported Superpowers major version");
  });

  it("does not prepare role guidance from a non-active state", () => {
    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();

    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(fixture.skills);
    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();
  });

  it("renders canonical starting-skill guidance under sole Crew authority", () => {
    const fixture = track(createStockSuperpowersFixture());
    captureSuperpowersSkills(fixture.skills);
    const worker = prepareSuperpowersLaunch("worker", "task-1");
    const reviewer = prepareSuperpowersLaunch("reviewer");
    if (!worker || !reviewer) throw new Error("active fixture did not prepare guidance");

    const packageRoot = fs.realpathSync(fixture.root);
    const guidance = renderSuperpowersGuidance(worker);
    expect(guidance).toBe([
      "Pi-messenger Crew is the sole orchestrator and task authority.",
      "Continue in the checkout assigned by Crew.",
      "Before acting, read each selected starting skill from its resolved installed path:",
      `- Skill: test-driven-development | Path: ${packageRoot}/skills/test-driven-development/SKILL.md | Reason: Apply RED-GREEN-REFACTOR to behavior changes.`,
      `- Skill: verification-before-completion | Path: ${packageRoot}/skills/verification-before-completion/SKILL.md | Reason: Run fresh checks before completion claims.`,
      "Crew-owned workflow restrictions:",
      "- Do not start nested agents or SDD controllers.",
      "- Do not start plan executors or branch-finishing workflows.",
      "- Do not create, switch to, or manage nested worktrees; use the checkout assigned by Crew.",
      "Other relevant installed skills remain available.",
    ].join("\n"));
    expect(guidance).not.toContain("writing-plans");
    expect(guidance.length).toBeLessThan(1_500);

    expect(renderSuperpowersGuidance(reviewer)).not.toContain("test-driven-development");
  });
});

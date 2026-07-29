import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSuperpowersSkills,
  getSuperpowersState,
  prepareSuperpowersLaunch,
  renderSuperpowersGuidance,
  resetSuperpowersStateForTests,
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

  beforeEach(resetSuperpowersStateForTests);
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

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

  it("does not prepare role guidance from a non-active state", () => {
    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();

    const fixture = track(createStockSuperpowersFixture({ version: "7.0.0" }));
    captureSuperpowersSkills(fixture.skills);
    expect(prepareSuperpowersLaunch("worker", "task-1")).toBeUndefined();
  });

  it("renders compact guidance for only the selected skills and Crew-owned workflows", () => {
    const fixture = track(createStockSuperpowersFixture());
    captureSuperpowersSkills(fixture.skills);
    const worker = prepareSuperpowersLaunch("worker", "task-1");
    const reviewer = prepareSuperpowersLaunch("reviewer");
    if (!worker || !reviewer) throw new Error("active fixture did not prepare guidance");

    const guidance = renderSuperpowersGuidance(worker);
    expect(guidance).toContain("test-driven-development");
    expect(guidance).toContain("verification-before-completion");
    expect(guidance).toContain("Do not start nested agents or SDD controllers.");
    expect(guidance).toContain("Do not start plan executors or branch-finishing workflows.");
    expect(guidance).toContain(
      "Do not create, switch to, or manage nested worktrees; use the checkout assigned by Crew.",
    );
    expect(guidance).toContain("Other relevant installed skills remain available");
    expect(guidance).not.toContain("writing-plans");
    expect(guidance.length).toBeLessThan(1_500);

    expect(renderSuperpowersGuidance(reviewer)).not.toContain("test-driven-development");
  });
});

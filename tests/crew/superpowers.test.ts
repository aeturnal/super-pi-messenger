import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSuperpowersSkills,
  getSuperpowersState,
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
});

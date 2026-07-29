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

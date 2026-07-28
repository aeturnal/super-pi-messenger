import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalTestRepository, fixedNow } from "./helpers.js";
import { resetIndependentParallel } from "../../evals/scripts/reset-independent-parallel.mjs";

describe("resetIndependentParallel", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function repository() {
    const result = createEvalTestRepository();
    cleanups.push(result.cleanup);
    return result;
  }

  it("copies the seed, creates a clean seed commit, and records hashes", () => {
    const { repositoryRoot, destination } = repository();
    const result = resetIndependentParallel({ repositoryRoot, destination, now: fixedNow });
    expect(fs.existsSync(path.resolve(destination, ".git"))).toBe(true);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: destination, encoding: "utf8" })).toBe("");
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, fixture: "independent-parallel" });
    expect(manifest.fixtureHashes).toEqual({
      "PRD.md": expect.any(String),
      "package.json": expect.any(String),
      "src/duration.mjs": expect.any(String),
      "src/format-bytes.mjs": expect.any(String),
      "src/retry-after.mjs": expect.any(String),
      "test/duration.test.mjs": expect.any(String),
      "test/format-bytes.test.mjs": expect.any(String),
      "test/retry-after.test.mjs": expect.any(String),
    });
    expect(Object.keys(manifest.testHashes)).toEqual([
      "test/duration.test.mjs", "test/format-bytes.test.mjs", "test/retry-after.test.mjs",
    ]);
    expect(manifest.profileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.seedCommit).toBe(result.seedCommit);
    expect(manifest.createdAt).toBe("2026-07-27T12:00:00.000Z");
    expect(manifest.result).toEqual({ status: "not-run", verifier: null, supervised: null });
    expect(JSON.parse(fs.readFileSync(path.join(destination, ".git", "pi-super-messenger-eval-marker.json"), "utf8"))).toEqual({ schemaVersion: 1, kind: "pi-super-messenger-eval-run", fixture: "independent-parallel" });
  });

  it("replaces only a previously marked run", () => {
    const { repositoryRoot, destination } = repository();
    resetIndependentParallel({ repositoryRoot, destination });
    fs.writeFileSync(path.join(destination, "discard-me"), "old");
    resetIndependentParallel({ repositoryRoot, destination });
    expect(fs.existsSync(path.join(destination, "discard-me"))).toBe(false);
  });

  it.each([
    ["the run root", ({ repositoryRoot }: { repositoryRoot: string }) => path.join(repositoryRoot, "evals", "runs", "independent-parallel")],
    ["the repository root", ({ repositoryRoot }: { repositoryRoot: string }) => repositoryRoot],
    ["the fixture seed", ({ repositoryRoot }: { repositoryRoot: string }) => path.join(repositoryRoot, "evals", "fixtures", "independent-parallel", "seed")],
    ["a path outside the run root", ({ repositoryRoot }: { repositoryRoot: string }) => path.join(repositoryRoot, "outside")],
  ])("rejects %s", (_name, target) => {
    const { repositoryRoot } = repository();
    expect(() => resetIndependentParallel({ repositoryRoot, destination: target({ repositoryRoot }) })).toThrow();
  });

  it("rejects an unmarked existing destination", () => {
    const { repositoryRoot, destination } = repository();
    fs.mkdirSync(destination, { recursive: true });
    expect(() => resetIndependentParallel({ repositoryRoot, destination })).toThrow(/marker/i);
  });

  it.each([
    ["malformed JSON", "not json"],
    ["wrong schema", JSON.stringify({ schemaVersion: 2, kind: "pi-super-messenger-eval-run", fixture: "independent-parallel" })],
    ["wrong kind", JSON.stringify({ schemaVersion: 1, kind: "other", fixture: "independent-parallel" })],
    ["wrong fixture", JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-eval-run", fixture: "other" })],
  ])("rejects a run with a %s marker", (_name, marker) => {
    const { repositoryRoot, destination } = repository();
    fs.mkdirSync(path.join(destination, ".git"), { recursive: true });
    fs.writeFileSync(path.join(destination, ".git", "pi-super-messenger-eval-marker.json"), marker);
    expect(() => resetIndependentParallel({ repositoryRoot, destination })).toThrow(/marker/i);
  });

  it("rejects a destination symlink", () => {
    const { repositoryRoot, destination } = repository();
    fs.symlinkSync(path.dirname(destination), destination, "dir");
    expect(() => resetIndependentParallel({ repositoryRoot, destination })).toThrow(/symbolic link/i);
  });

  it("rejects a symlink ancestor", () => {
    const { repositoryRoot, destination } = repository();
    const ancestor = path.dirname(destination);
    const actual = path.join(repositoryRoot, "actual-run-root");
    fs.renameSync(ancestor, actual);
    fs.symlinkSync(actual, ancestor, "dir");
    expect(() => resetIndependentParallel({ repositoryRoot, destination })).toThrow(/symbolic link/i);
  });
});

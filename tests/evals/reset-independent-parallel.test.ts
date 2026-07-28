import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalTestRepository, fixedNow } from "./helpers.js";
import { resetIndependentParallel } from "../../evals/scripts/reset-independent-parallel.mjs";
import { assertSafeDescendant, run, sha256File, sha256Json } from "../../evals/scripts/lib.mjs";

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

  it("rejects a symlink above run root before deleting a marked destination", () => {
    const { repositoryRoot, destination } = repository();
    resetIndependentParallel({ repositoryRoot, destination });
    const sentinel = path.join(destination, "must-not-delete");
    fs.writeFileSync(sentinel, "keep");
    const evals = path.join(repositoryRoot, "evals");
    const externalEvals = path.join(path.dirname(repositoryRoot), "external-evals");
    fs.renameSync(evals, externalEvals);
    fs.symlinkSync(externalEvals, evals, "dir");

    const runRoot = path.join(repositoryRoot, "evals", "runs", "independent-parallel");
    expect(() => assertSafeDescendant(runRoot, destination)).toThrow(/symbolic link/i);
    expect(() => resetIndependentParallel({ repositoryRoot, destination })).toThrow(/symbolic link/i);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("hashes file bytes and canonical JSON content", () => {
    const { repositoryRoot } = repository();
    const filePath = path.join(repositoryRoot, "hash-input");
    fs.writeFileSync(filePath, "abc");

    expect(sha256File(filePath)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Json({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
    expect(sha256Json({ b: { z: true, a: null }, a: [2, 1] })).toBe(sha256Json({ a: [2, 1], b: { a: null, z: true } }));
  });

  it("retains failed command status, stdout, and stderr", () => {
    let failure: any;
    try {
      run(process.execPath, ["-e", 'process.stdout.write("out"); process.stderr.write("err"); process.exit(7)']);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.status).toBe(7);
    expect(failure.signal).toBeNull();
    expect(failure.stdout).toBe("out");
    expect(failure.stderr).toBe("err");
    expect(failure.message).toContain("status 7");
  });

  it("retains failed command signal, stdout, and stderr", () => {
    let failure: any;
    try {
      run(process.execPath, ["-e", 'process.stdout.write("out"); process.stderr.write("err"); process.kill(process.pid, "SIGTERM")']);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.status).toBeNull();
    expect(failure.signal).toBe("SIGTERM");
    expect(failure.stdout).toBe("out");
    expect(failure.stderr).toBe("err");
    expect(failure.message).toContain("signal SIGTERM");
  });

  it("includes spawn-error diagnostics", () => {
    let failure: any;
    try {
      run("definitely-not-an-executable", []);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.status).toBeNull();
    expect(failure.signal).toBeNull();
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toBe("");
    expect(failure.message).toContain("error:");
    expect(failure.message).toMatch(/ENOENT|not found/i);
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

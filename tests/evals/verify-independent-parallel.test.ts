import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalTestRepository, writeKnownCorrectImplementations } from "./helpers.js";
import { resetIndependentParallel } from "../../evals/scripts/reset-independent-parallel.mjs";
import { verifyIndependentParallel } from "../../evals/scripts/verify-independent-parallel.mjs";

describe("verifyIndependentParallel", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function reset() {
    const repository = createEvalTestRepository();
    cleanups.push(repository.cleanup);
    const { worktree } = resetIndependentParallel({
      repositoryRoot: repository.repositoryRoot,
      destination: repository.destination,
    });
    return { ...repository, worktree };
  }

  it("fails untouched stubs before test execution", () => {
    const { repositoryRoot, worktree } = reset();
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/NOT_IMPLEMENTED/);
    expect(fs.existsSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"))).toBe(false);
  });

  it("runs the immutable tests and records a successful result", () => {
    const { repositoryRoot, worktree } = reset();
    writeKnownCorrectImplementations(worktree);
    const result = verifyIndependentParallel({ repositoryRoot, worktree });
    expect(result).toMatchObject({ passed: true, testExitCode: 0 });
    expect(result.testHashes).toEqual(expect.any(Object));
    expect(result.seedCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(result.headCommit).toBe(result.seedCommit);
    expect(result.gitStatus).toContain("src/");
    expect(result.stdout).toContain("pass");
    expect(result.stderr).toBe("");
    expect(JSON.parse(fs.readFileSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"), "utf8"))).toMatchObject({ passed: true, testExitCode: 0 });
  });

  it.each([
    ["modified", (worktree: string) => fs.appendFileSync(path.join(worktree, "test", "duration.test.mjs"), "\n// changed\n")],
    ["deleted", (worktree: string) => fs.rmSync(path.join(worktree, "test", "duration.test.mjs"))],
    ["renamed", (worktree: string) => fs.renameSync(path.join(worktree, "test", "duration.test.mjs"), path.join(worktree, "test", "renamed.test.mjs"))],
    ["additional", (worktree: string) => fs.writeFileSync(path.join(worktree, "test", "extra.test.mjs"), "")],
  ])("rejects %s acceptance tests before execution", (_kind, alter) => {
    const { repositoryRoot, worktree } = reset();
    alter(worktree);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/test (hash mismatch|paths mismatch)/i);
    expect(fs.existsSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"))).toBe(false);
  });

  it.each([
    ["missing marker", (worktree: string, repositoryRoot: string) => fs.rmSync(path.join(worktree, ".git", "pi-super-messenger-eval-marker.json"))],
    ["profile mismatch", (_worktree: string, repositoryRoot: string) => fs.appendFileSync(path.join(repositoryRoot, "evals", "profiles", "stock-baseline.json"), "\n")],
    ["missing source", (worktree: string) => fs.rmSync(path.join(worktree, "src", "duration.mjs"))],
  ])("rejects %s during preflight", (_name, alter) => {
    const { repositoryRoot, worktree } = reset();
    alter(worktree, repositoryRoot);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow();
  });

  it.each([
    ["a malformed marker", (worktree: string) => fs.writeFileSync(path.join(worktree, ".git", "pi-super-messenger-eval-marker.json"), "not-json")],
    ["a marker for another fixture", (worktree: string) => fs.writeFileSync(path.join(worktree, ".git", "pi-super-messenger-eval-marker.json"), JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-eval-run", fixture: "other" }))],
    ["a tampered fixture hash manifest", (worktree: string) => {
      const manifestPath = path.join(worktree, ".git", "pi-super-messenger-eval-run.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.fixtureHashes["src/duration.mjs"] = "0".repeat(64);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }],
    ["a tampered initial result schema", (worktree: string) => {
      const manifestPath = path.join(worktree, ".git", "pi-super-messenger-eval-run.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.result.status = "complete";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }],
  ])("rejects %s during preflight", (_name, alter) => {
    const { repositoryRoot, worktree } = reset();
    alter(worktree);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow();
  });

  it("rejects a remaining sentinel during preflight", () => {
    const { repositoryRoot, worktree } = reset();
    writeKnownCorrectImplementations(worktree);
    fs.writeFileSync(path.join(worktree, "src", "duration.mjs"), 'throw new Error("NOT_IMPLEMENTED");\n');
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/NOT_IMPLEMENTED/);
  });

  it("retains a result and diagnostics when executed tests fail", () => {
    const { repositoryRoot, worktree } = reset();
    writeKnownCorrectImplementations(worktree);
    fs.writeFileSync(path.join(worktree, "src", "duration.mjs"), "export function parseDuration() { return 0; }\n");
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/verification failed/i);
    const result = JSON.parse(fs.readFileSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"), "utf8"));
    expect(result).toMatchObject({ passed: false, testExitCode: 1 });
    expect(result.stdout + result.stderr).toContain("fail");
  });
});

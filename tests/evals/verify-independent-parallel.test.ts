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
    ["nested additional", (worktree: string) => {
      fs.mkdirSync(path.join(worktree, "test", "subdir"));
      fs.writeFileSync(path.join(worktree, "test", "subdir", "extra.test.mjs"), "");
    }],
  ])("rejects %s acceptance tests before execution", (_kind, alter) => {
    const { repositoryRoot, worktree } = reset();
    writeKnownCorrectImplementations(worktree);
    alter(worktree);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/test (hash mismatch|paths mismatch)/i);
    expect(fs.existsSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"))).toBe(false);
  });

  it.each([
    ["missing marker", (worktree: string, repositoryRoot: string) => fs.rmSync(path.join(worktree, ".git", "pi-super-messenger-eval-marker.json"))],
    ["profile hash mismatch", (worktree: string, repositoryRoot: string) => {
      writeKnownCorrectImplementations(worktree);
      const profilePath = path.join(repositoryRoot, "evals", "profiles", "stock-baseline.json");
      const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
      profile.coordination = "silent";
      fs.writeFileSync(profilePath, JSON.stringify(profile));
    }],
    ["missing source", (worktree: string) => fs.rmSync(path.join(worktree, "src", "duration.mjs"))],
  ])("rejects %s during preflight", (_name, alter) => {
    const { repositoryRoot, worktree } = reset();
    alter(worktree, repositoryRoot);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(_name === "profile hash mismatch" ? /profile hash mismatch/ : undefined);
    expect(fs.existsSync(path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"))).toBe(false);
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

  it.each([
    [".git directory", (worktree: string) => {
      fs.renameSync(path.join(worktree, ".git"), path.join(worktree, ".git-real"));
      fs.symlinkSync(".git-real", path.join(worktree, ".git"));
    }],
    ["fixture marker", (worktree: string) => {
      const marker = path.join(worktree, ".git", "pi-super-messenger-eval-marker.json");
      fs.renameSync(marker, `${marker}.real`);
      fs.symlinkSync(`${path.basename(marker)}.real`, marker);
    }],
    ["run manifest", (worktree: string) => {
      const manifest = path.join(worktree, ".git", "pi-super-messenger-eval-run.json");
      fs.renameSync(manifest, `${manifest}.real`);
      fs.symlinkSync(`${path.basename(manifest)}.real`, manifest);
    }],
    ["verification result", (worktree: string) => {
      const result = path.join(worktree, ".git", "pi-super-messenger-eval-verification.json");
      fs.writeFileSync(`${result}.real`, "must not be overwritten");
      fs.symlinkSync(`${path.basename(result)}.real`, result);
    }],
    ["dangling verification result", (worktree: string) => {
      fs.symlinkSync("missing-result.json", path.join(worktree, ".git", "pi-super-messenger-eval-verification.json"));
    }],
  ])("refuses a symbolic link for the %s", (_name, alter) => {
    const { repositoryRoot, worktree } = reset();
    writeKnownCorrectImplementations(worktree);
    alter(worktree);
    expect(() => verifyIndependentParallel({ repositoryRoot, worktree })).toThrow(/symbolic link/i);
    const result = path.join(worktree, ".git", "pi-super-messenger-eval-verification.json");
    if (fs.existsSync(`${result}.real`)) expect(fs.readFileSync(`${result}.real`, "utf8")).toBe("must not be overwritten");
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

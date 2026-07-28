import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupStockRuntime, defaultRuntimeRoot } from "../../evals/scripts/cleanup-stock-runtime.mjs";

const packageName = "npm:pi-messenger@0.14.1";
const runtimeName = "stock-pi-messenger-0.14.1";
const markerName = ".pi-super-messenger-stock-runtime.json";
const script = path.resolve("evals/scripts/cleanup-stock-runtime.mjs");

describe("cleanupStockRuntime", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function setup() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cleanup-test-"));
    cleanups.push(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const repositoryRoot = path.join(temporaryRoot, "repository");
    const runtimeRoot = path.join(temporaryRoot, "runtime-root");
    const runtimeDir = path.join(runtimeRoot, runtimeName);
    fs.mkdirSync(path.join(repositoryRoot, "evals", "runs"), { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(runtimeRoot) })}\n`);
    return { temporaryRoot, repositoryRoot, runtimeRoot, runtimeDir };
  }

  function setupCliRuntimeRoot(test: ReturnType<typeof setup>) {
    const childTmpdir = path.join(test.temporaryRoot, "child-tmpdir");
    const uid = process.getuid?.() ?? process.pid;
    fs.mkdirSync(childTmpdir, { recursive: true });
    return {
      runtimeRoot: path.join(childTmpdir, `pi-super-messenger-evals-${uid}`),
      env: { ...process.env, TMPDIR: childTmpdir, TMP: childTmpdir, TEMP: childTmpdir },
    };
  }

  function runCleanupCli(test: ReturnType<typeof setup>, args: string[], cli = setupCliRuntimeRoot(test)) {
    return { cli, result: spawnSync(process.execPath, [script, ...args], { cwd: test.repositoryRoot, env: cli.env, encoding: "utf8" }) };
  }

  it("removes only an exact marked runtime", () => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, "auth.json"), "fake credential");
    expect(cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toEqual({ removed: true });
    expect(fs.existsSync(test.runtimeDir)).toBe(false);
  });

  it("does not create an evidence destination passed to the deletion-only API", () => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, "terminal.log"), "raw runtime output");
    const evidenceDestination = path.join(test.repositoryRoot, "evals", "runs", "manual-evidence");

    expect(cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination })).toEqual({ removed: true });
    expect(fs.existsSync(evidenceDestination)).toBe(false);
    expect(fs.existsSync(test.runtimeDir)).toBe(false);
  });

  it("rejects an outside runtime without removing it", () => {
    const test = setup();
    const outside = path.join(test.temporaryRoot, "outside", runtimeName);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, markerName), "{}");
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: outside })).toThrow(/runtime|unsafe|expected/i);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("rejects symlinked runtime roots and intermediate ancestors", () => {
    const test = setup();
    const realRoot = path.join(test.temporaryRoot, "real-root");
    fs.mkdirSync(realRoot, { recursive: true });
    fs.rmSync(test.runtimeRoot, { recursive: true });
    fs.symlinkSync(realRoot, test.runtimeRoot, "dir");
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: path.join(test.runtimeRoot, runtimeName) })).toThrow(/symbolic|symlink|unsafe/i);

    const second = setup();
    const intermediate = path.join(second.runtimeRoot, "nested");
    fs.mkdirSync(path.join(second.temporaryRoot, "real-intermediate"), { recursive: true });
    fs.symlinkSync(path.join(second.temporaryRoot, "real-intermediate"), intermediate, "dir");
    expect(() => cleanupStockRuntime({ repositoryRoot: second.repositoryRoot, runtimeRoot: second.runtimeRoot, runtimeDir: path.join(intermediate, runtimeName) })).toThrow(/expected|unsafe|symbolic|symlink/i);
  });

  it("rejects a marker with an unexpected property using the correct runtime root", () => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(test.runtimeRoot), unexpected: true })}\n`);
    expect(() => cleanupStockRuntime({ runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toThrow(/marker|runtime/i);
    expect(fs.existsSync(test.runtimeDir)).toBe(true);
  });

  it.each([
    ["malformed marker", "not json"],
    ["array marker", JSON.stringify([])],
    ["string primitive marker", JSON.stringify("not an object")],
    ["number primitive marker", JSON.stringify(1)],
    ["boolean primitive marker", JSON.stringify(true)],
    ["null primitive marker", JSON.stringify(null)],
    ["wrong marker", JSON.stringify({ schemaVersion: 2, kind: "wrong", package: packageName, runtimeRoot: "/wrong" })],
  ])("rejects a %s without removing the runtime", (_name, marker) => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, markerName), marker);
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toThrow(/marker|runtime/i);
    expect(fs.existsSync(test.runtimeDir)).toBe(true);
  });

  it("fails missing runtime while prominently naming its expected path", () => {
    const test = setup();
    fs.rmSync(test.runtimeDir, { recursive: true });
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toThrow(test.runtimeDir);
  });

  it("reports the credential-bearing path when an already-removed marked runtime is cleaned again", () => {
    const test = setup();
    const sibling = path.join(test.runtimeRoot, "unrelated-runtime");
    fs.mkdirSync(sibling);

    expect(cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toEqual({ removed: true });
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toThrow(`Cleanup failed for runtime ${test.runtimeDir}: Runtime does not exist: ${test.runtimeDir}`);
    expect(fs.existsSync(test.runtimeDir)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("CLI uses an isolated default UID-scoped runtime root for an exact stock child", () => {
    const test = setup();
    const cli = setupCliRuntimeRoot(test);
    const runtimeDir = path.join(cli.runtimeRoot, runtimeName);
    expect(cli.runtimeRoot).not.toBe(defaultRuntimeRoot());
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(cli.runtimeRoot) })}\n`);

    const { result } = runCleanupCli(test, ["--runtime", runtimeDir], cli);
    expect(result.status).toBe(0);
    expect(fs.existsSync(runtimeDir)).toBe(false);
  });

  it("CLI rejects a correctly marked identically named runtime outside its isolated default root without mutation", () => {
    const test = setup();
    const outsideRoot = path.join(test.temporaryRoot, "outside-root");
    const outsideRuntime = path.join(outsideRoot, runtimeName);
    fs.mkdirSync(outsideRuntime, { recursive: true });
    fs.writeFileSync(path.join(outsideRuntime, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(outsideRoot) })}\n`);

    const { cli, result } = runCleanupCli(test, ["--runtime", outsideRuntime]);
    expect(cli.runtimeRoot).not.toBe(outsideRoot);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/expected|runtime|cleanup/i);
    expect(fs.existsSync(outsideRuntime)).toBe(true);
  });

  it("CLI rejects repeated, unknown, missing, and retired flags before mutation", () => {
    const test = setup();
    const cli = setupCliRuntimeRoot(test);
    const runtimeDir = path.join(cli.runtimeRoot, runtimeName);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(cli.runtimeRoot) })}\n`);

    for (const args of [["--unknown"], ["--runtime"], ["--runtime", runtimeDir, "--runtime", runtimeDir], ["--runtime", runtimeDir, "--evidence"]]) {
      const { result } = runCleanupCli(test, args, cli);
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(runtimeName);
      expect(fs.existsSync(runtimeDir)).toBe(true);
    }
  });
});

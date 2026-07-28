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

  it.each([
    ["malformed marker", "not json"],
    ["marker with an unexpected property", JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: "/wrong", unexpected: true })],
    ["array marker", JSON.stringify([])],
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

  it("CLI rejects --evidence before mutating a marked runtime", () => {
    const test = setup();
    const cli = setupCliRuntimeRoot(test);
    const runtimeDir = path.join(cli.runtimeRoot, runtimeName);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(cli.runtimeRoot) })}\n`);

    const { result } = runCleanupCli(test, ["--runtime", runtimeDir, "--evidence", path.join(test.repositoryRoot, "evals", "runs", "evidence")], cli);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown flag --evidence");
    expect(fs.existsSync(runtimeDir)).toBe(true);
  });
});

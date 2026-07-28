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

  it("removes a marked runtime and reports it removed", () => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, "auth.json"), "fake credential");
    expect(cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toEqual({ removed: true });
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

  it("rejects a marker with an unexpected property without removing the runtime", () => {
    const test = setup();
    fs.writeFileSync(path.join(test.runtimeDir, markerName), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(test.runtimeRoot), unexpected: true })}\n`);
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir })).toThrow(/marker|runtime/i);
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
  ])("rejects a %s", (_name, marker) => {
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

  it.each(["auth.json", "SETTINGS.JSON", "pi-messenger.json", "models-store.json", "credentials.txt", "secret.log", "TOKEN", "api-key.txt"])("rejects forbidden evidence basename %s", (name) => {
    const test = setup();
    fs.mkdirSync(path.join(test.runtimeDir, "sessions"));
    fs.writeFileSync(path.join(test.runtimeDir, "sessions", name), "credential");
    const evidence = path.join(test.repositoryRoot, "evals", "runs", "evidence");
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination: evidence })).toThrow(/forbidden|credential|evidence/i);
    expect(fs.existsSync(test.runtimeDir)).toBe(true);
  });

  it("rejects symlinks anywhere in selected evidence", () => {
    const test = setup();
    fs.mkdirSync(path.join(test.runtimeDir, "sessions", "nested"), { recursive: true });
    fs.writeFileSync(path.join(test.runtimeDir, "sessions", "nested", "safe.log"), "safe");
    fs.symlinkSync(path.join(test.runtimeDir, "sessions", "nested", "safe.log"), path.join(test.runtimeDir, "sessions", "link.log"));
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination: path.join(test.repositoryRoot, "evals", "runs", "evidence") })).toThrow(/symbolic|symlink/i);
  });

  it.each([
    ["private-key header", path.join("sessions", "nested", "transcript.log"), "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n"],
    ["apiKey JSON key", "terminal.log", '{"apiKey":"not-a-real-key"}\n'],
    ["api_key JSON key", "terminal.jsonl", '{"api_key":"not-a-real-key"}\n'],
    ["accessToken JSON key", "terminal.log", '{"accessToken":"not-a-real-token"}\n'],
    ["refreshToken JSON key", "terminal.jsonl", '{"refreshToken":"not-a-real-token"}\n'],
    ["authToken JSON key", "terminal.log", '{"authToken":"not-a-real-token"}\n'],
    ["oauthToken JSON key", "terminal.jsonl", '{"oauthToken":"not-a-real-token"}\n'],
    ["clientSecret JSON key", "terminal.log", '{"clientSecret":"not-a-real-secret"}\n'],
    ["API_KEY environment credential assignment", path.join("sessions", "environment.log"), "API_KEY=not-a-real-key\n"],
    ["AUTH_TOKEN environment credential assignment", "terminal.log", "AUTH_TOKEN=not-a-real-token\n"],
    ["OAUTH_TOKEN environment credential assignment", "terminal.jsonl", "OAUTH_TOKEN=not-a-real-token\n"],
    ["ACCESS_TOKEN environment credential assignment", "terminal.log", "ACCESS_TOKEN=not-a-real-token\n"],
    ["REFRESH_TOKEN environment credential assignment", "terminal.jsonl", "REFRESH_TOKEN=not-a-real-token\n"],
    ["Bearer token", "terminal.log", "Authorization: Bearer not-a-real-token\n"],
    ["binary NUL content", "terminal.jsonl", Buffer.from("safe\0unsafe")],
  ])("rejects retained evidence containing %s before creating its destination", (_name, relativePath, content) => {
    const test = setup();
    const source = path.join(test.runtimeDir, relativePath);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, content);
    const evidenceDestination = path.join(test.repositoryRoot, "evals", "runs", "evidence");

    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination })).toThrow(/evidence|credential|secret|binary|private|bearer/i);
    expect(fs.existsSync(test.runtimeDir)).toBe(true);
    expect(fs.existsSync(evidenceDestination)).toBe(false);
  });

  it("refuses an existing evidence destination without deleting the runtime", () => {
    const test = setup();
    const evidenceDestination = path.join(test.repositoryRoot, "evals", "runs", "evidence");
    fs.mkdirSync(evidenceDestination);
    fs.writeFileSync(path.join(evidenceDestination, "unrelated.txt"), "stale");
    expect(() => cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination })).toThrow(/evidence.*exist|exist.*evidence/i);
    expect(fs.readFileSync(path.join(evidenceDestination, "unrelated.txt"), "utf8")).toBe("stale");
    expect(fs.existsSync(test.runtimeDir)).toBe(true);
  });

  it("copies only allowed safe evidence before deleting credentials with runtime", () => {
    const test = setup();
    fs.mkdirSync(path.join(test.runtimeDir, "sessions", "nested"), { recursive: true });
    fs.writeFileSync(path.join(test.runtimeDir, "sessions", "nested", "output.txt"), "safe session");
    fs.writeFileSync(path.join(test.runtimeDir, "terminal.log"), "safe log");
    fs.writeFileSync(path.join(test.runtimeDir, "terminal.jsonl"), "{\"safe\":true}\n");
    fs.writeFileSync(path.join(test.runtimeDir, "other.txt"), "not evidence");
    fs.writeFileSync(path.join(test.runtimeDir, "auth.json"), "credential");
    const evidenceDestination = path.join(test.repositoryRoot, "evals", "runs", "evidence");
    expect(cleanupStockRuntime({ repositoryRoot: test.repositoryRoot, runtimeRoot: test.runtimeRoot, runtimeDir: test.runtimeDir, evidenceDestination })).toEqual({ removed: true, evidencePath: evidenceDestination });
    expect(fs.readFileSync(path.join(evidenceDestination, "sessions", "nested", "output.txt"), "utf8")).toBe("safe session");
    expect(fs.existsSync(path.join(evidenceDestination, "terminal.log"))).toBe(true);
    expect(fs.existsSync(path.join(evidenceDestination, "terminal.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(evidenceDestination, "other.txt"))).toBe(false);
    expect(fs.existsSync(path.join(evidenceDestination, "auth.json"))).toBe(false);
    expect(fs.existsSync(test.runtimeDir)).toBe(false);
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

  it("CLI rejects invalid flags before mutation", () => {
    const test = setup();
    for (const args of [["--unknown"], ["--runtime"], ["--runtime", test.runtimeDir, "--runtime", test.runtimeDir], ["--runtime", test.runtimeDir, "--evidence"]]) {
      const { result } = runCleanupCli(test, args);
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(runtimeName);
      expect(fs.existsSync(test.runtimeDir)).toBe(true);
    }
  });
});

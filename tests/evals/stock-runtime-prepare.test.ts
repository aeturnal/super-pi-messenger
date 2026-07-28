import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createEvalTestRepository } from "./helpers.js";
import { prepareStockRuntime } from "../../evals/scripts/prepare-stock-runtime.mjs";

const packageName = "npm:pi-messenger@0.14.1";
const script = path.resolve("evals/scripts/prepare-stock-runtime.mjs");

describe("prepareStockRuntime", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  function setup(options: { auth?: boolean; packages?: string[]; models?: string[]; modelOutput?: string; failInstall?: boolean; failModels?: boolean; malformedSettings?: boolean } = {}) {
    const repository = createEvalTestRepository();
    cleanups.push(repository.cleanup);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-stock-test-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourceAgentDir = path.join(root, "source");
    fs.mkdirSync(sourceAgentDir, { recursive: true });
    if (options.auth !== false) fs.writeFileSync(path.join(sourceAgentDir, "auth.json"), '{"token":"fake"}');
    fs.writeFileSync(path.join(sourceAgentDir, "models-store.json"), '{"cached":"fake"}');
    const logPath = path.join(root, "pi-log.json");
    const piCommand = path.join(root, "fake-pi.mjs");
    fs.writeFileSync(piCommand, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = process.env.PI_CODING_AGENT_DIR;
const log = fs.existsSync(${JSON.stringify(logPath)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(logPath)}, "utf8")) : [];
log.push({ args: process.argv.slice(2), root, cwd: process.cwd() });
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(log));
if (process.argv[2] === "install") {
  if (${Boolean(options.failInstall)}) { process.stderr.write("install failed"); process.exit(7); }
  fs.writeFileSync(path.join(root, "settings.json"), ${options.malformedSettings ? '"not-json"' : 'JSON.stringify({ packages: JSON.parse(process.env.FAKE_PACKAGES || ' + JSON.stringify(JSON.stringify(options.packages ?? [packageName])) + ') })'});
}
if (process.argv[2] === "--list-models") {
  if (${Boolean(options.failModels)}) { process.stderr.write("model listing failed"); process.exit(8); }
  process.stdout.write(process.env.FAKE_MODELS || ${JSON.stringify(options.modelOutput ?? (options.models ?? ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "openai-codex/gpt-5.6-luna"]).join("\n"))});
}
`);
    fs.chmodSync(piCommand, 0o755);
    return { ...repository, root, sourceAgentDir, runtimeRoot: path.join(root, "runtime"), piCommand, logPath };
  }

  it.each([
    ["repository root", (test: ReturnType<typeof setup>) => test.repositoryRoot],
    ["repository descendant", (test: ReturnType<typeof setup>) => path.join(test.repositoryRoot, "runtime-root")],
    ["symlink-resolved repository descendant", (test: ReturnType<typeof setup>) => {
      const target = path.join(test.repositoryRoot, "resolved-runtime-root");
      const link = path.join(test.root, "runtime-root-link");
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, "dir");
      return link;
    }],
  ])("rejects a %s runtime root before creating credentials or a marker", (_kind, runtimeRootFor) => {
    const test = setup();
    const runtimeRoot = runtimeRootFor(test);
    const resolvedRuntimeRoot = fs.existsSync(runtimeRoot) ? fs.realpathSync.native(runtimeRoot) : path.resolve(runtimeRoot);
    const runtimeDir = path.join(resolvedRuntimeRoot, "stock-pi-messenger-0.14.1");

    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot, piCommand: test.piCommand })).toThrow(`Unsafe resolved runtime root: ${resolvedRuntimeRoot}`);
    expect(fs.existsSync(path.join(runtimeDir, "auth.json"))).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir, ".pi-super-messenger-stock-runtime.json"))).toBe(false);
  });

  it("CLI rejects a repository-local default runtime root before creating credentials or a marker", () => {
    const test = setup();
    const temporaryDirectory = path.join(test.repositoryRoot, "temporary-directory");
    const uid = process.getuid?.() ?? process.pid;
    const runtimeRoot = path.join(temporaryDirectory, `pi-super-messenger-evals-${uid}`);
    const runtimeDir = path.join(runtimeRoot, "stock-pi-messenger-0.14.1");
    fs.mkdirSync(temporaryDirectory);

    const result = spawnSync(process.execPath, [script, "--source-agent-dir", test.sourceAgentDir], {
      cwd: test.repositoryRoot,
      env: { ...process.env, TMPDIR: temporaryDirectory, TMP: temporaryDirectory, TEMP: temporaryDirectory, PATH: path.dirname(process.execPath) },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Unsafe resolved runtime root: ${runtimeRoot}`);
    expect(result.stderr).not.toContain("fake");
    expect(fs.existsSync(path.join(runtimeDir, "auth.json"))).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir, ".pi-super-messenger-stock-runtime.json"))).toBe(false);
  });

  it("creates an isolated marked runtime with only stock configuration", () => {
    const test = setup();
    const worktree = path.join(test.root, "work tree; safe");
    fs.mkdirSync(worktree, { recursive: true });
    const result = prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand, worktree });
    const runtimeDir = path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1");
    expect(result).toMatchObject({ runtimeDir, packageSource: packageName, profileHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.parse(fs.readFileSync(test.logPath, "utf8"))).toEqual([
      { args: ["install", packageName], root: runtimeDir, cwd: test.repositoryRoot },
      { args: ["--list-models"], root: runtimeDir, cwd: test.repositoryRoot },
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, ".pi-super-messenger-stock-runtime.json"), "utf8"))).toEqual({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: packageName, runtimeRoot: path.resolve(test.runtimeRoot) });
    expect(fs.statSync(path.join(runtimeDir, "auth.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(runtimeDir, "models-store.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "settings.json"), "utf8"))).toEqual({ packages: [packageName] });
    const profile = JSON.parse(fs.readFileSync(path.join(test.repositoryRoot, "evals/profiles/stock-baseline.json"), "utf8"));
    const { package: _package, ...crew } = profile;
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, "pi-messenger.json"), "utf8"))).toEqual({ crew });
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, ".pi-super-messenger-stock-preparation.json"), "utf8"))).toMatchObject({ schemaVersion: 1, package: packageName, profileHash: result.profileHash, exactModels: ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "openai-codex/gpt-5.6-luna"], worktree });
    expect(result.launchCommand).toContain("PI_CODING_AGENT_DIR=");
    expect(result.launchCommand).toContain(`'${worktree}'`);
    expect(result.launchCommand).not.toContain("--no-extensions");
  });

  it("accepts Pi's tabular model-list output using exact provider/model pairs", () => {
    const test = setup({
      modelOutput: [
        "provider      model          context  max-out  thinking  images",
        "openai-codex  gpt-5.6-sol    272K     128K     yes       yes",
        "openai-codex  gpt-5.6-terra  272K     128K     yes       yes",
        "openai-codex  gpt-5.6-luna   272K     128K     yes       yes",
      ].join("\n"),
    });

    const result = prepareStockRuntime({
      repositoryRoot: test.repositoryRoot,
      sourceAgentDir: test.sourceAgentDir,
      runtimeRoot: test.runtimeRoot,
      piCommand: test.piCommand,
    });

    expect(result.packageSource).toBe(packageName);
  });

  it("shell-quotes apostrophes in runtime and worktree paths", () => {
    const test = setup();
    const runtimeRoot = path.join(test.root, "runtime's root");
    const worktree = path.join(test.root, "worktree's path");
    fs.mkdirSync(worktree, { recursive: true });
    const result = prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot, piCommand: test.piCommand, worktree });
    const capturePath = path.join(test.root, "launch-argv.json");
    const bin = path.join(test.root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "pi"), `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ argv: process.argv.slice(2), root: process.env.PI_CODING_AGENT_DIR, cwd: process.cwd() }));
`);
    fs.chmodSync(path.join(bin, "pi"), 0o755);
    expect(spawnSync("sh", ["-n", "-c", result.launchCommand], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("sh", ["-c", result.launchCommand], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" }).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(capturePath, "utf8"))).toEqual({
      argv: ["--model", "openai-codex/gpt-5.6-sol"],
      root: path.join(runtimeRoot, "stock-pi-messenger-0.14.1"),
      cwd: worktree,
    });
  });

  it.each(["runtime root", "an existing runtime-root ancestor"])("rejects a symlinked %s before creating credentials or a marker", (kind) => {
    const test = setup();
    const target = path.join(test.root, "symlink-target");
    fs.mkdirSync(target);
    const runtimeRoot = kind === "runtime root" ? path.join(test.root, "runtime-link") : path.join(test.root, "ancestor-link", "runtime");
    fs.symlinkSync(target, kind === "runtime root" ? runtimeRoot : path.dirname(runtimeRoot));
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot, piCommand: test.piCommand })).toThrow(/symbolic link/i);
    const escapedRuntimeDir = kind === "runtime root"
      ? path.join(target, "stock-pi-messenger-0.14.1")
      : path.join(target, "runtime", "stock-pi-messenger-0.14.1");
    expect(fs.existsSync(path.join(escapedRuntimeDir, "auth.json"))).toBe(false);
    expect(fs.existsSync(path.join(escapedRuntimeDir, ".pi-super-messenger-stock-runtime.json"))).toBe(false);
  });

  it("rejects missing authentication before creating the runtime", () => {
    const test = setup({ auth: false });
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(/auth/i);
    expect(fs.existsSync(test.runtimeRoot)).toBe(false);
  });

  it.each([
    ["install process failure", { failInstall: true }, /install failed/],
    ["model-list process failure", { failModels: true }, /model listing failed/],
  ])("retains an exactly marked runtime and its credential-bearing path after %s", (_name, options, error) => {
    const test = setup(options);
    const runtimeDir = path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1");
    let thrown: unknown;
    try {
      prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(error);
    expect((thrown as Error).message).toContain(runtimeDir);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, ".pi-super-messenger-stock-runtime.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "pi-super-messenger-stock-runtime",
      package: packageName,
      runtimeRoot: path.resolve(test.runtimeRoot),
    });
    expect(fs.statSync(runtimeDir).isDirectory()).toBe(true);
  });

  it.each([
    ["malformed isolated settings", { malformedSettings: true }, /Invalid isolated settings/],
    ["unexpected installed package", { packages: [packageName, "npm:superpowers@1.0.0"] }, /exactly the pinned/],
    ["unavailable pinned model", { models: ["openai-codex/gpt-5.6-sol"] }, /Pinned model is unavailable/],
  ])("retains a marked cleanable runtime after %s", (_name, options, error) => {
    const test = setup(options);
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(error);
    const runtimeDir = path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1");
    expect(fs.existsSync(path.join(runtimeDir, ".pi-super-messenger-stock-runtime.json"))).toBe(true);
    expect(fs.statSync(runtimeDir).isDirectory()).toBe(true);
  });

  it("rejects an existing runtime before mutation", () => {
    const test = setup();
    fs.mkdirSync(path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1"), { recursive: true });
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(/already exists/i);
  });

  it("CLI reports a credential-bearing source path without creating a runtime", () => {
    const test = setup({ auth: false });
    const result = spawnSync(process.execPath, [script, "--source-agent-dir", test.sourceAgentDir], { cwd: test.repositoryRoot, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required auth.json");
    expect(result.stderr).toContain(test.sourceAgentDir);
  });

  it("CLI treats runtime-root as an unknown flag", () => {
    const test = setup();
    const result = spawnSync(process.execPath, [script, "--runtime-root", test.runtimeRoot], { cwd: test.repositoryRoot, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
    expect(result.stderr).not.toContain("runtime-root <directory>");
  });

  it("CLI rejects invalid source flags before mutation", () => {
    const test = setup();
    for (const args of [["--unknown"], ["--source-agent-dir"], ["--source-agent-dir", test.sourceAgentDir, "--source-agent-dir", test.sourceAgentDir]]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: test.repositoryRoot, env: { ...process.env, PI_CODING_AGENT_DIR: test.sourceAgentDir }, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
  });
});

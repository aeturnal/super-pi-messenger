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

  function setup(options: { auth?: boolean; packages?: string[]; models?: string[] } = {}) {
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
if (process.argv[2] === "install") fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ packages: JSON.parse(process.env.FAKE_PACKAGES || ${JSON.stringify(JSON.stringify(options.packages ?? [packageName]))}) }));
if (process.argv[2] === "--list-models") process.stdout.write(process.env.FAKE_MODELS || ${JSON.stringify((options.models ?? ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "openai-codex/gpt-5.6-luna"]).join("\n"))});
`);
    fs.chmodSync(piCommand, 0o755);
    return { ...repository, root, sourceAgentDir, runtimeRoot: path.join(root, "runtime"), piCommand, logPath };
  }

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

  it("rejects missing authentication before creating the runtime", () => {
    const test = setup({ auth: false });
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(/auth/i);
    expect(fs.existsSync(test.runtimeRoot)).toBe(false);
  });

  it.each([
    ["unexpected installed package", [packageName, "npm:superpowers@1.0.0"]],
    ["unavailable pinned model", ["openai-codex/gpt-5.6-sol"]],
  ])("retains a marked cleanable runtime after %s", (_name, value) => {
    const test = _name.includes("package") ? setup({ packages: value as string[] }) : setup({ models: value as string[] });
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(/runtime retained at/i);
    expect(fs.existsSync(path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1", ".pi-super-messenger-stock-runtime.json"))).toBe(true);
  });

  it("rejects an existing runtime before mutation", () => {
    const test = setup();
    fs.mkdirSync(path.join(test.runtimeRoot, "stock-pi-messenger-0.14.1"), { recursive: true });
    expect(() => prepareStockRuntime({ repositoryRoot: test.repositoryRoot, sourceAgentDir: test.sourceAgentDir, runtimeRoot: test.runtimeRoot, piCommand: test.piCommand })).toThrow(/already exists/i);
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

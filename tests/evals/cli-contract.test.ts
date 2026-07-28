import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(".");
const readmePath = path.join(repositoryRoot, "evals", "README.md");
const prepareScript = path.join(repositoryRoot, "evals", "scripts", "prepare-stock-runtime.mjs");
const cleanupScript = path.join(repositoryRoot, "evals", "scripts", "cleanup-stock-runtime.mjs");
const runtimeName = "stock-pi-messenger-0.14.1";

function runCli(script: string, args: string[], environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
  });
}

describe("documented stock-runtime CLI contract", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("documents only parser-accepted preparation and cleanup command shapes", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cli-contract-"));
    cleanups.push(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const missingAgentDirectory = path.join(temporaryRoot, "missing-agent");
    const childTmpdir = path.join(temporaryRoot, "tmp");
    const runtimeDirectory = path.join(childTmpdir, `pi-super-messenger-evals-${process.getuid?.() ?? process.pid}`, runtimeName);
    const environment = {
      ...process.env,
      PI_CODING_AGENT_DIR: missingAgentDirectory,
      TMPDIR: childTmpdir,
      TMP: childTmpdir,
      TEMP: childTmpdir,
    };
    const readme = fs.readFileSync(readmePath, "utf8");

    expect(readme).not.toContain("--runtime-root");
    expect(readme).toContain("node evals/scripts/prepare-stock-runtime.mjs [--source-agent-dir PATH]");
    expect(readme).toContain("node evals/scripts/cleanup-stock-runtime.mjs --runtime PATH [--evidence PATH]");

    for (const args of [[], ["--source-agent-dir", missingAgentDirectory]]) {
      const result = runCli(prepareScript, args, environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing required auth.json");
      expect(fs.existsSync(runtimeDirectory)).toBe(false);
    }
    for (const args of [["--runtime", runtimeDirectory], ["--runtime", runtimeDirectory, "--evidence", path.join(temporaryRoot, "evidence")]]) {
      const result = runCli(cleanupScript, args, environment);
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/Runtime does not exist|Cleanup failed/);
      expect(fs.existsSync(runtimeDirectory)).toBe(false);
    }
  });
});

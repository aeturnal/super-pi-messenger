import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(".");
const readmePath = path.join(repositoryRoot, "evals", "README.md");
const prepareScript = path.join(repositoryRoot, "evals", "scripts", "prepare-stock-runtime.mjs");
const cleanupScript = path.join(repositoryRoot, "evals", "scripts", "cleanup-stock-runtime.mjs");
const planPath = path.join(repositoryRoot, "docs", "superpowers", "plans", "2026-07-27-phase-0-eval-foundation.md");
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

  function missingRuntimeContext() {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-cli-contract-"));
    cleanups.push(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const missingAgentDirectory = path.join(temporaryRoot, "missing-agent");
    const childTmpdir = path.join(temporaryRoot, "tmp");
    const runtimeDirectory = path.join(childTmpdir, `pi-super-messenger-evals-${process.getuid?.() ?? process.pid}`, runtimeName);
    return {
      temporaryRoot,
      missingAgentDirectory,
      runtimeDirectory,
      environment: {
        ...process.env,
        PI_CODING_AGENT_DIR: missingAgentDirectory,
        TMPDIR: childTmpdir,
        TMP: childTmpdir,
        TEMP: childTmpdir,
      },
    };
  }

  it("documents only parser-accepted preparation and cleanup command shapes", () => {
    const { missingAgentDirectory, runtimeDirectory, environment } = missingRuntimeContext();
    const readme = fs.readFileSync(readmePath, "utf8");

    expect(readme).not.toContain("--runtime-root");
    expect(readme).toContain("node evals/scripts/prepare-stock-runtime.mjs [--source-agent-dir PATH]");
    expect(readme).toContain("node evals/scripts/cleanup-stock-runtime.mjs --runtime PATH");
    expect(readme).not.toContain("cleanup-stock-runtime.mjs --runtime PATH [--evidence PATH]");

    for (const args of [[], ["--source-agent-dir", missingAgentDirectory]]) {
      const result = runCli(prepareScript, args, environment);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing required auth.json");
      expect(fs.existsSync(runtimeDirectory)).toBe(false);
    }
  });

  it("derives documented cleanup runtime paths from prepared runtime evidence", () => {
    const plan = fs.readFileSync(planPath, "utf8");

    expect(plan).toContain('RUNTIME_PATH=$(node -e \'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("evals/runs/independent-parallel/prepared-runtime.json", "utf8")); process.stdout.write(p.runtimeDir)\')');
    expect(plan).toContain('node evals/scripts/cleanup-stock-runtime.mjs --runtime "$RUNTIME_PATH"');
    expect(plan).not.toContain("cleanup-stock-runtime.mjs --runtime \"$RUNTIME_PATH\" --evidence");
    expect(plan).not.toContain("/tmp/pi-super-messenger-evals-1000");
    expect(plan).toContain("UID-scoped OS temporary root");
  });

  it("passes parser validation for the documented cleanup shape", () => {
    const { runtimeDirectory, environment } = missingRuntimeContext();
    const result = runCli(cleanupScript, ["--runtime", runtimeDirectory], environment);
    const combinedOutput = `${result.stdout}${result.stderr}`;
    const expectedMessage = `Runtime does not exist: ${runtimeDirectory}`;

    expect(result.status).toBe(1);
    expect(combinedOutput).toContain(expectedMessage);
    for (const parserFailure of ["Unknown flag", "Missing value", "Missing required --runtime"]) {
      expect(combinedOutput).not.toContain(parserFailure);
    }
    expect(combinedOutput).not.toMatch(/^Cleanup failed\s*$/);
    expect(fs.existsSync(runtimeDirectory)).toBe(false);
  });

  it("rejects the retired --evidence flag before cleanup", () => {
    const { runtimeDirectory, environment } = missingRuntimeContext();
    const result = runCli(cleanupScript, ["--runtime", runtimeDirectory, "--evidence", "ignored"], environment);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown flag --evidence");
    expect(fs.existsSync(runtimeDirectory)).toBe(false);
  });
});

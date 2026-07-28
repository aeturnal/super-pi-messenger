import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeDescendant, run, sha256Json } from "./lib.mjs";

const PACKAGE = "npm:pi-messenger@0.14.1";
const RUNTIME_NAME = "stock-pi-messenger-0.14.1";
const MARKER = ".pi-super-messenger-stock-runtime.json";
const PREPARATION = ".pi-super-messenger-stock-preparation.json";

function readJson(filePath, description) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw new Error(`Invalid ${description}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultRuntimeRoot() {
  return path.join(os.tmpdir(), `pi-super-messenger-evals-${process.getuid?.() ?? process.pid}`);
}

function resolveSymlinks(filePath) {
  const unresolved = [];
  for (let current = path.resolve(filePath); ; current = path.dirname(current)) {
    try {
      return path.join(fs.realpathSync.native(current), ...unresolved.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      unresolved.push(path.basename(current));
    }
  }
}

function assertRuntimeRootOutsideRepository(repositoryRoot, runtimeRoot) {
  const resolvedRepository = resolveSymlinks(repositoryRoot);
  const resolvedRuntimeRoot = resolveSymlinks(runtimeRoot);
  const relativeRuntime = path.relative(resolvedRepository, resolvedRuntimeRoot);
  if (!relativeRuntime || (!relativeRuntime.startsWith(`..${path.sep}`) && relativeRuntime !== ".." && !path.isAbsolute(relativeRuntime))) {
    throw new Error(`Unsafe resolved runtime root: ${resolvedRuntimeRoot} is within repository root ${resolvedRepository}`);
  }
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function parseAvailableModels(output) {
  const models = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const columns = line.split(/\s+/);
    if (columns.length === 1 && /^[^/\s]+\/[^/\s]+$/.test(columns[0])) {
      models.add(columns[0]);
    } else if (columns.length >= 2 && columns[0] !== "provider" && columns[1] !== "model") {
      models.add(`${columns[0]}/${columns[1]}`);
    }
  }
  return models;
}

function copyCredential(source, target) {
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function checkedProfile(repositoryRoot) {
  const profile = readJson(path.join(repositoryRoot, "evals", "profiles", "stock-baseline.json"), "stock profile");
  if (profile.package !== PACKAGE || !profile.models || typeof profile.models !== "object") throw new Error("Invalid stock profile");
  return profile;
}

function retainedError(runtimeDir, error) {
  return new Error(`Preparation failed; credential-bearing runtime retained at: ${runtimeDir}\n${error instanceof Error ? error.message : String(error)}`);
}

export function prepareStockRuntime({ repositoryRoot, sourceAgentDir, runtimeRoot, piCommand = "pi", worktree } = {}) {
  const repository = path.resolve(repositoryRoot ?? process.cwd());
  const source = path.resolve(sourceAgentDir ?? process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"));
  const root = path.resolve(runtimeRoot ?? defaultRuntimeRoot());
  const runtimeDir = path.join(root, RUNTIME_NAME);
  const auth = path.join(source, "auth.json");
  assertRuntimeRootOutsideRepository(repository, root);
  if (!fs.existsSync(auth) || !fs.lstatSync(auth).isFile()) throw new Error(`Missing required auth.json in source agent directory: ${source}`);
  assertSafeDescendant(root, runtimeDir);
  if (fs.existsSync(runtimeDir)) throw new Error(`Stock runtime already exists: ${runtimeDir}`);

  const profile = checkedProfile(repository);
  const profileHash = sha256Json(profile);
  const targetWorktree = path.resolve(worktree ?? path.join(repository, "evals", "runs", "independent-parallel", "worktree"));
  let marked = false;
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(runtimeDir, { recursive: false, mode: 0o700 });
    fs.writeFileSync(path.join(runtimeDir, MARKER), `${JSON.stringify({ schemaVersion: 1, kind: "pi-super-messenger-stock-runtime", package: PACKAGE, runtimeRoot: root })}\n`, { mode: 0o600 });
    marked = true;
    copyCredential(auth, path.join(runtimeDir, "auth.json"));
    const modelStore = path.join(source, "models-store.json");
    if (fs.existsSync(modelStore)) {
      if (!fs.lstatSync(modelStore).isFile()) throw new Error(`models-store.json is not a regular file: ${modelStore}`);
      copyCredential(modelStore, path.join(runtimeDir, "models-store.json"));
    }

    const env = { ...process.env, PI_CODING_AGENT_DIR: runtimeDir };
    run(piCommand, ["install", PACKAGE], { cwd: repository, env });
    const settings = readJson(path.join(runtimeDir, "settings.json"), "isolated settings");
    if (!Array.isArray(settings.packages) || settings.packages.length !== 1 || settings.packages[0] !== PACKAGE) throw new Error("Isolated settings must contain exactly the pinned pi-messenger package");
    if (settings.packages.some((entry) => typeof entry !== "string" || /superpowers|compat/i.test(entry))) throw new Error("Isolated settings contain a forbidden extension package");

    const { package: _package, ...crew } = profile;
    fs.writeFileSync(path.join(runtimeDir, "pi-messenger.json"), `${JSON.stringify({ crew }, null, 2)}\n`, { mode: 0o600 });
    const available = parseAvailableModels(run(piCommand, ["--list-models"], { cwd: repository, env }).stdout);
    const exactModels = [...new Set(Object.values(profile.models))];
    for (const model of exactModels) {
      if (!available.has(model)) throw new Error(`Pinned model is unavailable: ${model}`);
    }
    const preparation = { schemaVersion: 1, package: PACKAGE, profileHash, createdAt: new Date().toISOString(), exactModels, worktree: targetWorktree };
    fs.writeFileSync(path.join(runtimeDir, PREPARATION), `${JSON.stringify(preparation, null, 2)}\n`, { mode: 0o600 });
    return {
      runtimeDir,
      packageSource: PACKAGE,
      profileHash,
      launchCommand: `cd ${quoteShell(targetWorktree)} && PI_CODING_AGENT_DIR=${quoteShell(runtimeDir)} pi --model ${quoteShell(profile.models.planner)}`,
    };
  } catch (error) {
    if (marked) throw retainedError(runtimeDir, error);
    throw error;
  }
}

function parseCli(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (flag !== "--source-agent-dir") {
      throw new Error("Usage: prepare-stock-runtime.mjs [--source-agent-dir <directory>]");
    }
    if (Object.hasOwn(values, flag)) throw new Error(`Repeated flag ${flag}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values[flag] = value;
    index += 1;
  }
  return { sourceAgentDir: values["--source-agent-dir"] };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const result = prepareStockRuntime(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

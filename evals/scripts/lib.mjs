import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export function assertSafeDescendant(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === ".." || isAbsolute(relativeTarget)) {
    throw new Error(`Unsafe path: ${resolvedTarget} is not a descendant of ${resolvedRoot}`);
  }

  let current = resolvedRoot;
  for (const component of relativeTarget.split(sep)) {
    if (!component) continue;
    if (existsWithoutFollowingLinks(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Unsafe path: symbolic link in ancestor ${current}`);
    }
    current = resolve(current, component);
  }
  if (existsWithoutFollowingLinks(current) && lstatSync(current).isSymbolicLink()) {
    throw new Error(`Unsafe path: symbolic link at ${current}`);
  }
  return resolvedTarget;
}

function existsWithoutFollowingLinks(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `status ${result.status}`;
    const error = new Error(`Command failed: ${command} ${args.join(" ")} (${outcome})\nstdout:\n${stdout}\nstderr:\n${stderr}${result.error ? `\nerror: ${result.error.message}` : ""}`);
    error.stdout = stdout;
    error.stderr = stderr;
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }
  return { stdout, stderr, status: result.status, signal: result.signal };
}

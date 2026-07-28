import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface EvalTestRepository {
  repositoryRoot: string;
  destination: string;
  cleanup: () => void;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function createEvalTestRepository(): EvalTestRepository {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-messenger-eval-test-"));
  const evalRoot = path.join(temporaryRoot, "repo", "evals");
  fs.mkdirSync(evalRoot, { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "evals", "fixtures", "independent-parallel"), path.join(evalRoot, "fixtures", "independent-parallel"), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "evals", "profiles"), path.join(evalRoot, "profiles"), { recursive: true });
  const runRoot = path.join(evalRoot, "runs", "independent-parallel");
  fs.mkdirSync(runRoot, { recursive: true });

  return {
    repositoryRoot: path.join(temporaryRoot, "repo"),
    destination: path.join(runRoot, "worktree"),
    cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

export function fixedNow(): Date {
  return new Date("2026-07-27T12:00:00.000Z");
}

export function writeKnownCorrectImplementations(worktree: string): void {
  fs.writeFileSync(path.resolve(worktree, "src/duration.mjs"), `
export function parseDuration(input) {
  if (typeof input !== "string") throw new TypeError("duration must be a string");
  const match = input.trim().match(/^(\\d+(?:\\.\\d+)?)\\s*(ms|s|m|h)$/);
  if (!match) throw new TypeError("invalid duration");
  return Number(match[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
}
`);
  fs.writeFileSync(path.resolve(worktree, "src/format-bytes.mjs"), `
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0 || !Number.isInteger(bytes)) throw new TypeError("bytes must be a finite nonnegative integer");
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return \`${"${"}unit === 0 ? value : Math.round(value * 10) / 10} ${"${"}units[unit]}\`;
}
`);
  fs.writeFileSync(path.resolve(worktree, "src/retry-after.mjs"), `
export function parseRetryAfter(value, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite");
  if (typeof value !== "string" || value.trim() === "") return null;
  const header = value.trim();
  if (/^\\d+$/.test(header)) return Number(header) * 1000;
  const target = Date.parse(header);
  return Number.isNaN(target) ? null : Math.max(0, target - nowMs);
}
`);
}

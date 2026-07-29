import * as fs from "node:fs";
import * as path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

export interface SkillRef {
  name: string;
  description: string;
  filePath: string;
}

export type SuperpowersState =
  | { status: "inactive" }
  | { status: "fallback"; reason: string; correctiveAction: string; version?: string }
  | {
      status: "active";
      version: string;
      packageRoot: string;
      skills: Record<"test-driven-development" | "verification-before-completion", SkillRef>;
    };

const SUPPORTED_MAJOR = 6;
const REQUIRED_NAMES = ["test-driven-development", "verification-before-completion"] as const;
const STOCK_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";

let superpowersState: SuperpowersState = { status: "inactive" };

function normalizeOfficialSource(value: string): string {
  return value.trim()
    .replace(/^git:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git(?=@|$)/, "")
    .replace(/@[^/]+$/, "");
}

function isOfficialSource(value: string): boolean {
  return normalizeOfficialSource(value) === "obra/superpowers";
}

function fallback(reason: string, version?: string): SuperpowersState {
  superpowersState = {
    status: "fallback",
    reason,
    correctiveAction: "Reinstall the official Superpowers package.",
    ...(version === undefined ? {} : { version }),
  };
  return superpowersState;
}

export function captureSuperpowersSkills(skills: readonly Skill[]): SuperpowersState {
  if (skills.length === 0) {
    superpowersState = { status: "inactive" };
    return superpowersState;
  }

  try {
    const officialSkills = skills.filter((skill) => isOfficialSource(skill.sourceInfo.source));
    const baseDir = officialSkills[0]?.sourceInfo.baseDir;
    if (!baseDir) return fallback("unable to validate official Superpowers package source");

    const packageRoot = fs.realpathSync(baseDir);
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { name?: unknown; version?: unknown };

    if (packageJson.name !== "superpowers") {
      return fallback("invalid Superpowers package metadata");
    }
    if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
      return fallback("invalid Superpowers version");
    }

    const version = packageJson.version;
    const major = version.split(".", 1)[0];
    if (major !== String(SUPPORTED_MAJOR)) {
      return fallback("unsupported Superpowers major version", version);
    }

    const extension = fs.readFileSync(
      path.join(packageRoot, ".pi", "extensions", "superpowers.ts"),
      "utf8",
    );
    if (!extension.includes(STOCK_BOOTSTRAP_MARKER)) {
      return fallback("missing Superpowers bootstrap marker", version);
    }

    const requiredSkills = {} as Record<(typeof REQUIRED_NAMES)[number], SkillRef>;
    for (const name of REQUIRED_NAMES) {
      const skill = officialSkills.find((candidate) => candidate.name === name);
      if (!skill) return fallback(`missing required Superpowers skill: ${name}`, version);

      const skillBaseDir = skill.sourceInfo.baseDir;
      if (!skillBaseDir) {
        return fallback(`invalid canonical path for Superpowers skill: ${name}`, version);
      }

      const expectedPath = path.join(packageRoot, "skills", name, "SKILL.md");
      const canonicalPath = fs.realpathSync(skill.filePath);
      if (canonicalPath !== expectedPath || fs.realpathSync(skillBaseDir) !== packageRoot) {
        return fallback(`invalid canonical path for Superpowers skill: ${name}`, version);
      }
      fs.accessSync(canonicalPath, fs.constants.R_OK);
      requiredSkills[name] = {
        name: skill.name,
        description: skill.description,
        filePath: canonicalPath,
      };
    }

    superpowersState = {
      status: "active",
      version,
      packageRoot,
      skills: requiredSkills,
    };
    return superpowersState;
  } catch {
    return fallback("unable to validate Superpowers package");
  }
}

export function getSuperpowersState(): SuperpowersState {
  return superpowersState;
}

export function resetSuperpowersStateForTests(): void {
  superpowersState = { status: "inactive" };
}

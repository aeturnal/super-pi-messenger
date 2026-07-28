import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  bin: Record<string, string>;
  repository: { url: string };
};

describe("Super Pi Messenger public identity", () => {
  it("states the product, lineage, prerelease status, and independence", () => {
    expect(readme).toContain("# Super Pi Messenger");
    expect(readme).toContain("independently maintained prerelease fork");
    expect(readme).toContain("nicobailon/pi-messenger");
    expect(readme).toContain("separately installed stock Obra Superpowers");
    expect(readme).toContain("not affiliated with or endorsed by Obra");
  });

  it("installs the development product from its GitHub fork, not upstream npm", () => {
    expect(readme).toContain(
      "pi install git:github.com/aeturnal/super-pi-messenger",
    );
    expect(readme).not.toContain("pi install npm:pi-messenger");
    expect(readme).not.toContain("shields.io/npm/v/pi-messenger");
  });

  it("uses the renamed package and repository while preserving technical runtime names", () => {
    expect(readme).toContain("pi_messenger");
    expect(readme).toContain("npx pi-messenger --crew-install");
    expect(readme).toContain(".pi/messenger");
    expect(packageJson.name).toBe("super-pi-messenger");
    expect(packageJson.bin).toEqual({ "pi-messenger": "install.mjs" });
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/aeturnal/super-pi-messenger.git",
    );
  });
});

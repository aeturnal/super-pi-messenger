import { describe, expect, it } from "vitest";

describe("temporary branch-protection probe", () => {
  it("intentionally fails so the required check blocks this disposable PR", () => {
    expect("temporary required-check failure").toBe("expected pass");
  });
});

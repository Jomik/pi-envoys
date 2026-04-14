import { describe, expect, it } from "vitest";
import { allocateRunId, generateName } from "../src/naming.js";

describe("allocateRunId", () => {
  it("returns a 12-char hex string", () => {
    const id = allocateRunId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => allocateRunId()));
    expect(ids.size).toBe(100);
  });
});

describe("generateName", () => {
  it("returns adjective-noun format", () => {
    const name = generateName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("generates varied names", () => {
    const names = new Set(Array.from({ length: 50 }, () => generateName()));
    // With 32×32 = 1024 combos and 50 draws, collisions should be rare
    expect(names.size).toBeGreaterThan(30);
  });
});

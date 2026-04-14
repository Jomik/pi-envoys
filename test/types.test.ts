import { describe, expect, it } from "vitest";
import {
  canTransition,
  isTerminal,
  TERMINAL_STATUSES,
  type RunStatus,
} from "../src/types.js";

describe("status model", () => {
  const ALL_STATUSES: RunStatus[] = ["running", "completed", "failed", "stopped"];
  const TERMINAL: RunStatus[] = ["completed", "failed", "stopped"];

  describe("isTerminal", () => {
    it.each(TERMINAL)("%s is terminal", (s) => {
      expect(isTerminal(s)).toBe(true);
    });

    it("running is not terminal", () => {
      expect(isTerminal("running")).toBe(false);
    });
  });

  describe("TERMINAL_STATUSES set", () => {
    it("contains exactly the terminal statuses", () => {
      expect([...TERMINAL_STATUSES].sort()).toEqual(TERMINAL.sort());
    });
  });

  describe("canTransition", () => {
    it("allows running → completed", () => {
      expect(canTransition("running", "completed")).toBe(true);
    });

    it("allows running → failed", () => {
      expect(canTransition("running", "failed")).toBe(true);
    });

    it("allows running → stopped", () => {
      expect(canTransition("running", "stopped")).toBe(true);
    });

    it("rejects running → running", () => {
      expect(canTransition("running", "running")).toBe(false);
    });

    it.each(TERMINAL)("rejects transition from terminal %s", (from) => {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    });
  });
});

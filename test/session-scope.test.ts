import { describe, expect, it } from "vitest";
import { extractSpawnedRunIds } from "../src/session-scope.js";

describe("extractSpawnedRunIds", () => {
  it("returns empty for no entries", () => {
    expect(extractSpawnedRunIds([])).toEqual([]);
  });

  it("extracts runIds from envoy_spawn entries", () => {
    const entries = [
      { type: "message", id: "1", parentId: null, timestamp: "t" },
      { type: "custom", id: "2", parentId: "1", timestamp: "t", customType: "envoy_spawn", data: { runId: "aaa" } },
      { type: "message", id: "3", parentId: "2", timestamp: "t" },
      { type: "custom", id: "4", parentId: "3", timestamp: "t", customType: "envoy_spawn", data: { runId: "bbb" } },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual(["aaa", "bbb"]);
  });

  it("ignores non-envoy custom entries", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "other_thing", data: { runId: "aaa" } },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual([]);
  });

  it("ignores non-custom entry types", () => {
    const entries = [
      { type: "message", id: "1", parentId: null, timestamp: "t" },
      { type: "compaction", id: "2", parentId: "1", timestamp: "t" },
      { type: "model_change", id: "3", parentId: "2", timestamp: "t" },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual([]);
  });

  it("deduplicates runIds", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "envoy_spawn", data: { runId: "aaa" } },
      { type: "custom", id: "2", parentId: "1", timestamp: "t", customType: "envoy_spawn", data: { runId: "aaa" } },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual(["aaa"]);
  });

  it("preserves insertion order", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "envoy_spawn", data: { runId: "ccc" } },
      { type: "custom", id: "2", parentId: "1", timestamp: "t", customType: "envoy_spawn", data: { runId: "aaa" } },
      { type: "custom", id: "3", parentId: "2", timestamp: "t", customType: "envoy_spawn", data: { runId: "bbb" } },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual(["ccc", "aaa", "bbb"]);
  });

  it("skips entries with missing data", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "envoy_spawn" },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual([]);
  });

  it("skips entries with missing runId", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "envoy_spawn", data: {} },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual([]);
  });

  it("skips entries with non-string runId", () => {
    const entries = [
      { type: "custom", id: "1", parentId: null, timestamp: "t", customType: "envoy_spawn", data: { runId: 42 } },
    ];
    expect(extractSpawnedRunIds(entries)).toEqual([]);
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  getAgentDir: () => mockAgentDir,
}));

let mockAgentDir: string;

import {
  createRunDir,
  listRunIds,
  promptPath,
  readJsonOrUndefined,
  readRequest,
  readResult,
  readStatus,
  removeRunDir,
  requestPath,
  resolveRunStoreRoot,
  resultPath,
  statusPath,
  writeJsonAtomic,
  writeRequest,
  writeResult,
  writeStatus,
} from "../src/store.js";
import type { RequestFile, ResultFile, StatusFile } from "../src/types.js";

// ── Helpers ──

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-test-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── resolveRunStoreRoot ──

describe("resolveRunStoreRoot", () => {
  it("appends envoys/runs/ to getAgentDir()", () => {
    mockAgentDir = "/custom/agent-dir";
    const root = resolveRunStoreRoot();
    expect(root).toBe("/custom/agent-dir/envoys/runs");
  });
});

// ── createRunDir ──

describe("createRunDir", () => {
  it("creates nested directories", () => {
    const storeRoot = join(tmpRoot, "store", "runs");
    const runDir = createRunDir(storeRoot, "abc123");
    expect(existsSync(runDir)).toBe(true);
    expect(runDir).toBe(join(storeRoot, "abc123"));
  });

  it("is idempotent", () => {
    const storeRoot = join(tmpRoot, "store", "runs");
    createRunDir(storeRoot, "abc123");
    const runDir = createRunDir(storeRoot, "abc123");
    expect(existsSync(runDir)).toBe(true);
  });
});

// ── Atomic JSON writes ──

describe("writeJsonAtomic / readJsonOrUndefined", () => {
  it("round-trips an object", () => {
    const file = join(tmpRoot, "data.json");
    const obj = { hello: "world", n: 42 };
    writeJsonAtomic(file, obj);
    expect(readJsonOrUndefined(file)).toEqual(obj);
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    const file = join(tmpRoot, "pretty.json");
    writeJsonAtomic(file, { a: 1 });
    const raw = readFileSync(file, "utf-8");
    expect(raw).toBe('{\n  "a": 1\n}\n');
  });

  it("overwrites atomically", () => {
    const file = join(tmpRoot, "atomic.json");
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });
    expect(readJsonOrUndefined(file)).toEqual({ v: 2 });
  });

  it("leaves no temp files on success", () => {
    const file = join(tmpRoot, "clean.json");
    writeJsonAtomic(file, { ok: true });
    const siblings = readdirSync(tmpRoot);
    expect(siblings).toEqual(["clean.json"]);
  });

  it("returns undefined for missing file", () => {
    expect(readJsonOrUndefined(join(tmpRoot, "nope.json"))).toBeUndefined();
  });
});

// ── Per-run file helpers ──

const SAMPLE_REQUEST: RequestFile = {
  runId: "r1",
  name: "bold-hawk",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_STATUS: StatusFile = {
  runId: "r1",
  name: "bold-hawk",
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: "2026-01-01T00:00:01.000Z",
  pid: 12345,
};

const SAMPLE_RESULT: ResultFile = {
  runId: "r1",
  name: "bold-hawk",
  status: "completed",
  finishedAt: "2026-01-01T00:00:05.000Z",
  exitCode: 0,
  finalText: "Done.",
};

describe("per-run file helpers", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = join(tmpRoot, "r1");
    mkdirSync(runDir, { recursive: true });
  });

  it("writes and reads request.json", () => {
    writeRequest(runDir, SAMPLE_REQUEST);
    expect(readRequest(runDir)).toEqual(SAMPLE_REQUEST);
    expect(existsSync(requestPath(runDir))).toBe(true);
  });

  it("writes and reads status.json", () => {
    writeStatus(runDir, SAMPLE_STATUS);
    expect(readStatus(runDir)).toEqual(SAMPLE_STATUS);
    expect(existsSync(statusPath(runDir))).toBe(true);
  });

  it("writes and reads result.json", () => {
    writeResult(runDir, SAMPLE_RESULT);
    expect(readResult(runDir)).toEqual(SAMPLE_RESULT);
    expect(existsSync(resultPath(runDir))).toBe(true);
  });

  it("readRequest returns undefined for missing run dir", () => {
    expect(readRequest(join(tmpRoot, "nonexistent"))).toBeUndefined();
  });

  it("file layout matches spec", () => {
    writeRequest(runDir, SAMPLE_REQUEST);
    writeStatus(runDir, SAMPLE_STATUS);
    writeResult(runDir, SAMPLE_RESULT);
    writeFileSync(promptPath(runDir), "do the thing", "utf-8");

    const files = readdirSync(runDir).sort();
    expect(files).toEqual([
      "prompt.md",
      "request.json",
      "result.json",
      "status.json",
    ]);
  });
});

// ── listRunIds ──

describe("listRunIds", () => {
  it("lists run directories", () => {
    const storeRoot = join(tmpRoot, "store");
    mkdirSync(storeRoot, { recursive: true });
    createRunDir(storeRoot, "aaa");
    createRunDir(storeRoot, "bbb");
    createRunDir(storeRoot, "ccc");

    const ids = listRunIds(storeRoot).sort();
    expect(ids).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("returns empty for nonexistent store root", () => {
    expect(listRunIds(join(tmpRoot, "nope"))).toEqual([]);
  });

  it("ignores files (only directories)", () => {
    const storeRoot = join(tmpRoot, "store");
    mkdirSync(storeRoot, { recursive: true });
    createRunDir(storeRoot, "run1");
    // write a stray file
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(storeRoot, "stray.txt"), "oops");

    expect(listRunIds(storeRoot)).toEqual(["run1"]);
  });
});

// ── removeRunDir ──

describe("removeRunDir", () => {
  it("removes an existing run dir", () => {
    const storeRoot = join(tmpRoot, "store");
    const runDir = createRunDir(storeRoot, "todelete");
    writeJsonAtomic(join(runDir, "request.json"), { x: 1 });

    removeRunDir(storeRoot, "todelete");
    expect(existsSync(runDir)).toBe(false);
  });

  it("is silent for nonexistent run", () => {
    const storeRoot = join(tmpRoot, "store");
    mkdirSync(storeRoot, { recursive: true });
    // should not throw
    removeRunDir(storeRoot, "ghost");
  });
});

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecorderCore } from "../src/recorder-core.js";
import {
  readResult,
  readStatus,
  writeRequest,
  writeStatus,
} from "../src/store.js";
import type { RequestFile, StatusFile } from "../src/types.js";

let tmpRoot: string;
let runDir: string;

const SAMPLE_REQUEST: RequestFile = {
  runId: "r1",
  name: "bold-hawk",
  prompt: "do the thing",
  model: "test-model",
  cwd: "/tmp",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_STATUS: StatusFile = {
  runId: "r1",
  name: "bold-hawk",
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  pid: 12345,
  model: "test-model",
  cwd: "/tmp",
};

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-rec-"));
  runDir = join(tmpRoot, "r1");
  mkdirSync(runDir, { recursive: true });
  writeRequest(runDir, SAMPLE_REQUEST);
  writeStatus(runDir, { ...SAMPLE_STATUS });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── markRecorderStarted ──

describe("markRecorderStarted", () => {
  it("writes recorderStartedAt", () => {
    const recorder = new RecorderCore(runDir);
    recorder.markRecorderStarted();

    const status = readStatus(runDir)!;
    expect(status.recorderStartedAt).toBeDefined();
    expect(new Date(status.recorderStartedAt!).getTime()).toBeGreaterThan(0);
  });

  it("updates lastActivityAt", () => {
    const recorder = new RecorderCore(runDir);
    recorder.markRecorderStarted();

    const status = readStatus(runDir)!;
    expect(status.lastActivityAt).toBe(status.recorderStartedAt);
  });
});

// ── recordActivity ──

describe("recordActivity", () => {
  it("updates lastActivityAt", () => {
    const recorder = new RecorderCore(runDir);
    recorder.recordActivity();

    const status = readStatus(runDir)!;
    expect(new Date(status.lastActivityAt).getTime()).toBeGreaterThan(
      new Date(SAMPLE_STATUS.lastActivityAt).getTime(),
    );
  });

  it("throttles writes", () => {
    const recorder = new RecorderCore(runDir);

    // First write goes through
    recorder.recordActivity();
    const first = readStatus(runDir)!.lastActivityAt;

    // Immediate second write is throttled
    recorder.recordActivity();
    const second = readStatus(runDir)!.lastActivityAt;

    expect(second).toBe(first);
  });
});

// ── readPromptFromRequest ──

describe("readPromptFromRequest", () => {
  it("reads prompt from request.json", () => {
    const recorder = new RecorderCore(runDir);
    expect(recorder.readPromptFromRequest()).toBe("do the thing");
  });
});

// ── finalizeOnce ──

describe("finalizeOnce", () => {
  it("writes completed on clean exit", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0);
    recorder.setFinalText("All done.");
    recorder.finalizeOnce();

    const status = readStatus(runDir)!;
    expect(status.status).toBe("completed");
    expect(status.finalizingAt).toBeDefined();
    expect(status.terminalAt).toBeDefined();

    const result = readResult(runDir)!;
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe("All done.");
  });

  it("writes failed on nonzero exit", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(1);
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.exitCode).toBe(1);
  });

  it("writes failed on error message", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setErrorMessage("something broke");
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("failed");
    const result = readResult(runDir)!;
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("something broke");
  });

  it("writes stopped on SIGTERM only with parent stop evidence", () => {
    // First set up parent stop evidence
    const status = readStatus(runDir)!;
    status.termSignalSentAt = new Date().toISOString();
    writeStatus(runDir, status);

    const recorder = new RecorderCore(runDir);
    recorder.setSignal("SIGTERM");
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("stopped");
    expect(readResult(runDir)!.status).toBe("stopped");
    expect(readResult(runDir)!.signal).toBe("SIGTERM");
  });

  it("writes failed on SIGTERM without parent stop evidence", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setSignal("SIGTERM");
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.signal).toBe("SIGTERM");
  });

  it("writes failed on SIGINT (never sent by stop_envoy)", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setSignal("SIGINT");
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.signal).toBe("SIGINT");
  });

  it("writes stopped when stop signal evidence exists in status.json", () => {
    const status = readStatus(runDir)!;
    status.termSignalSentAt = new Date().toISOString();
    writeStatus(runDir, status);

    const recorder = new RecorderCore(runDir);
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("stopped");
  });

  it("writes stopped with killSignalSentAt evidence", () => {
    const status = readStatus(runDir)!;
    status.killSignalSentAt = new Date().toISOString();
    writeStatus(runDir, status);

    const recorder = new RecorderCore(runDir);
    recorder.finalizeOnce();

    expect(readStatus(runDir)!.status).toBe("stopped");
  });

  it("is idempotent — second call is a no-op", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0);
    recorder.finalizeOnce();

    const firstResult = readResult(runDir)!;

    recorder.setErrorMessage("should be ignored");
    recorder.finalizeOnce();

    const secondResult = readResult(runDir)!;
    expect(secondResult).toEqual(firstResult);
    expect(recorder.isFinalized).toBe(true);
  });

  it("captures model and usage", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0);
    recorder.setModel("gpt-5");
    recorder.setUsage({ input: 100, output: 50 });
    recorder.finalizeOnce();

    const result = readResult(runDir)!;
    expect(result.model).toBe("gpt-5");
    expect(result.usage).toEqual({ input: 100, output: 50 });
  });

  it("respects override status", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0); // would normally be "completed"
    recorder.finalizeOnce("failed");

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.status).toBe("failed");
  });

  it("does not overwrite already terminal status.json", () => {
    // Manually mark as completed first
    const status = readStatus(runDir)!;
    status.status = "completed";
    status.terminalAt = new Date().toISOString();
    writeStatus(runDir, status);

    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(1);
    recorder.finalizeOnce("failed");

    // Should remain completed — finalizeOnce respects existing terminal
    expect(readStatus(runDir)!.status).toBe("completed");
  });

  it("writes finalizingAt before result.json", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0);
    recorder.finalizeOnce();

    const status = readStatus(runDir)!;
    const result = readResult(runDir)!;
    expect(status.finalizingAt).toBeDefined();
    // finalizingAt should be <= finishedAt (same second typically)
    expect(new Date(status.finalizingAt!).getTime()).toBeLessThanOrEqual(
      new Date(result.finishedAt).getTime(),
    );
  });

  it("defaults model from status.json when not set on recorder", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setExitCode(0);
    recorder.finalizeOnce();

    const result = readResult(runDir)!;
    expect(result.model).toBe("test-model"); // from SAMPLE_STATUS
  });
});

// ── uncaughtException / unhandledRejection paths ──

describe("failure-path finalization", () => {
  it("uncaughtException marks failed", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setErrorMessage("uncaughtException: boom");
    recorder.setExitCode(1);
    recorder.finalizeOnce("failed");

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.errorMessage).toBe("uncaughtException: boom");
  });

  it("unhandledRejection marks failed", () => {
    const recorder = new RecorderCore(runDir);
    recorder.setErrorMessage("unhandledRejection: promise failed");
    recorder.setExitCode(1);
    recorder.finalizeOnce("failed");

    expect(readStatus(runDir)!.status).toBe("failed");
    expect(readResult(runDir)!.errorMessage).toBe(
      "unhandledRejection: promise failed",
    );
  });
});

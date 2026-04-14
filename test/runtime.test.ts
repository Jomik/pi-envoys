import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLauncher } from "../src/process.js";
import { EnvoyRuntime } from "../src/runtime.js";
import {
  readRequest,
  readResult,
  readStatus,
  writeResult,
  writeStatus,
} from "../src/store.js";

const FAST_TIMINGS = {
  stopGraceMs: 100,
  finalizeWaitMs: 500,
  finalizePollMs: 20,
  stopPollMs: 20,
};

let tmpRoot: string;
let launcher: FakeLauncher;
let runtime: EnvoyRuntime;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-rt-"));
  launcher = new FakeLauncher();
  runtime = new EnvoyRuntime(tmpRoot, launcher, FAST_TIMINGS);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── spawnRun ──

describe("spawnRun", () => {
  it("returns running status with runId and name", async () => {
    const out = await runtime.spawnRun({ prompt: "do stuff" });
    expect(out.status).toBe("running");
    expect(out.runId).toMatch(/^[0-9a-f]{12}$/);
    expect(out.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(out.runDir).toBe(join(tmpRoot, out.runId));
  });

  it("persists request.json with prompt", async () => {
    const out = await runtime.spawnRun({ prompt: "hello world", model: "gpt-5" });
    const req = readRequest(out.runDir);
    expect(req).toBeDefined();
    expect(req!.prompt).toBe("hello world");
    expect(req!.model).toBe("gpt-5");
    expect(req!.runId).toBe(out.runId);
    expect(req!.name).toBe(out.name);
  });

  it("persists status.json with pid", async () => {
    const out = await runtime.spawnRun({ prompt: "test" });
    const status = readStatus(out.runDir);
    expect(status).toBeDefined();
    expect(status!.status).toBe("running");
    expect(status!.pid).toBeGreaterThan(0);
    expect(status!.runId).toBe(out.runId);
  });

  it("passes optional cwd through", async () => {
    const out = await runtime.spawnRun({ prompt: "x", cwd: "/some/dir" });
    const req = readRequest(out.runDir);
    expect(req!.cwd).toBe("/some/dir");
    const status = readStatus(out.runDir);
    expect(status!.cwd).toBe("/some/dir");
  });
});

// ── listRuns ──

describe("listRuns", () => {
  it("returns empty for fresh store", async () => {
    expect(await runtime.listRuns()).toEqual([]);
  });

  it("lists spawned runs from disk", async () => {
    await runtime.spawnRun({ prompt: "a" });
    await runtime.spawnRun({ prompt: "b" });
    const runs = await runtime.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "running")).toBe(true);
  });

  it("returns correct fields", async () => {
    const out = await runtime.spawnRun({ prompt: "test", model: "m1" });
    const [entry] = await runtime.listRuns();
    expect(entry.runId).toBe(out.runId);
    expect(entry.name).toBe(out.name);
    expect(entry.status).toBe("running");
    expect(entry.model).toBe("m1");
    expect(entry.runDir).toBe(out.runDir);
    expect(entry.startedAt).toBeDefined();
    expect(entry.lastActivityAt).toBeDefined();
  });

  it("reconciles stale running status", async () => {
    const out = await runtime.spawnRun({ prompt: "will crash" });
    const status = readStatus(out.runDir)!;
    launcher.kill(status.pid!);

    // listRuns should reconcile — the dead run should be failed, not running
    const runs = await runtime.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
  });
});

// ── reconcileRun ──

describe("reconcileRun", () => {
  it("returns terminal status unchanged", async () => {
    const out = await runtime.spawnRun({ prompt: "done" });
    // Manually mark as completed
    const status = readStatus(out.runDir)!;
    status.status = "completed";
    status.terminalAt = new Date().toISOString();
    writeStatus(out.runDir, status);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("completed");
  });

  it("keeps running when pid is alive", async () => {
    const out = await runtime.spawnRun({ prompt: "still going" });
    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("running");
  });

  it("syncs status from result.json when pid is dead", async () => {
    const out = await runtime.spawnRun({ prompt: "will finish" });
    const status = readStatus(out.runDir)!;

    // Simulate: child wrote result.json then died
    writeResult(out.runDir, {
      runId: out.runId,
      name: out.name,
      status: "completed",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      finalText: "All done.",
    });
    launcher.kill(status.pid!);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("completed");
  });

  it("marks failed when pid is dead with no result and no stop evidence", async () => {
    const out = await runtime.spawnRun({ prompt: "will crash" });
    const status = readStatus(out.runDir)!;
    launcher.kill(status.pid!);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("failed");

    const result = readResult(out.runDir);
    expect(result).toBeDefined();
    expect(result!.status).toBe("failed");
  });

  it("marks stopped when pid is dead with signal evidence but no result", async () => {
    const out = await runtime.spawnRun({ prompt: "will be stopped" });
    const status = readStatus(out.runDir)!;

    // Simulate: parent sent SIGTERM, child died without finalizing
    status.termSignalSentAt = new Date().toISOString();
    writeStatus(out.runDir, status);
    launcher.kill(status.pid!);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("stopped");
  });

  it("stopRequestedAt alone does not imply stopped", async () => {
    const out = await runtime.spawnRun({ prompt: "ambiguous" });
    const status = readStatus(out.runDir)!;

    // Only stopRequestedAt — no signal evidence
    status.stopRequestedAt = new Date().toISOString();
    writeStatus(out.runDir, status);
    launcher.kill(status.pid!);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("failed");
  });

  it("marks failed when no pid was recorded", async () => {
    const out = await runtime.spawnRun({ prompt: "broken launch" });
    // Simulate: pid was never recorded (clear it)
    const status = readStatus(out.runDir)!;
    delete status.pid;
    writeStatus(out.runDir, status);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("failed");
    expect(readResult(out.runDir)!.errorMessage).toMatch(/No pid/);
  });

  it("throws for nonexistent runId", async () => {
    await expect(runtime.reconcileRun("nonexistent")).rejects.toThrow(/not found/);
  });

  it("waits for result when finalizingAt is recent", async () => {
    const out = await runtime.spawnRun({ prompt: "finalizing" });
    const status = readStatus(out.runDir)!;

    // Simulate: child set finalizingAt and died, result arrives shortly after
    status.finalizingAt = new Date().toISOString();
    writeStatus(out.runDir, status);
    launcher.kill(status.pid!);

    // Write result after a short delay
    setTimeout(() => {
      writeResult(out.runDir, {
        runId: out.runId,
        name: out.name,
        status: "completed",
        finishedAt: new Date().toISOString(),
        exitCode: 0,
      });
    }, 100);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("completed");
  });

  it("times out finalization wait and marks failed", async () => {
    const out = await runtime.spawnRun({ prompt: "stale finalizing" });
    const status = readStatus(out.runDir)!;

    // Simulate: finalizingAt is old (beyond FINALIZE_WAIT_MS)
    status.finalizingAt = new Date(Date.now() - 60_000).toISOString();
    writeStatus(out.runDir, status);
    launcher.kill(status.pid!);

    const reconciled = await runtime.reconcileRun(out.runId);
    expect(reconciled.status).toBe("failed");
  });
});

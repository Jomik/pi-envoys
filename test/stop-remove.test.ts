import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLauncher } from "../src/process.js";
import { EnvoyRuntime } from "../src/runtime.js";
import {
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
  waitPollMs: 50,
};

let tmpRoot: string;
let launcher: FakeLauncher;
let runtime: EnvoyRuntime;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-sr-"));
  launcher = new FakeLauncher();
  runtime = new EnvoyRuntime(tmpRoot, launcher, FAST_TIMINGS);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── stopRun ──

describe("stopRun", () => {
  it("produces stopped status", async () => {
    const out = await runtime.spawnRun({ prompt: "long task" });
    // FakeLauncher: SIGTERM doesn't kill, SIGKILL does
    const result = await runtime.stopRun(out.runId);
    expect(result.status).toBe("stopped");
  });

  it("sends SIGTERM then escalates to SIGKILL", async () => {
    const out = await runtime.spawnRun({ prompt: "stubborn" });
    const status = readStatus(out.runDir)!;
    const pid = status.pid!;

    await runtime.stopRun(out.runId);

    const signals = launcher.signals.get(pid) ?? [];
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGKILL");
    expect(signals.indexOf("SIGTERM")).toBeLessThan(signals.indexOf("SIGKILL"));
  });

  it("persists stop evidence timestamps", async () => {
    const out = await runtime.spawnRun({ prompt: "track me" });
    await runtime.stopRun(out.runId);

    const finalStatus = readStatus(out.runDir)!;
    expect(finalStatus.stopRequestedAt).toBeDefined();
    expect(finalStatus.termSignalSentAt).toBeDefined();
    // SIGKILL is sent because FakeLauncher ignores SIGTERM
    expect(finalStatus.killSignalSentAt).toBeDefined();
  });

  it("does not escalate if SIGTERM kills the process", async () => {
    const out = await runtime.spawnRun({ prompt: "polite" });
    const status = readStatus(out.runDir)!;
    const pid = status.pid!;

    // Make SIGTERM actually kill
    const origSendSignal = launcher.sendSignal.bind(launcher);
    launcher.sendSignal = (p, sig) => {
      origSendSignal(p, sig);
      if (sig === "SIGTERM") launcher.kill(p);
    };

    await runtime.stopRun(out.runId);

    const signals = launcher.signals.get(pid) ?? [];
    expect(signals).toContain("SIGTERM");
    expect(signals).not.toContain("SIGKILL");
  });

  it("is a no-op on already terminal run", async () => {
    const out = await runtime.spawnRun({ prompt: "already done" });

    // Simulate child completing on its own
    const status = readStatus(out.runDir)!;
    launcher.kill(status.pid!);
    writeResult(out.runDir, {
      runId: out.runId,
      name: out.name,
      status: "completed",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });
    status.status = "completed";
    status.terminalAt = new Date().toISOString();
    writeStatus(out.runDir, status);

    const result = await runtime.stopRun(out.runId);
    expect(result.status).toBe("completed"); // not stopped
  });

  it("respects child-written terminal state after stop", async () => {
    const out = await runtime.spawnRun({ prompt: "fast exit" });
    const status = readStatus(out.runDir)!;
    const _pid = status.pid!;

    // Simulate: child writes terminal 'failed' and dies on SIGTERM
    const origSendSignal = launcher.sendSignal.bind(launcher);
    launcher.sendSignal = (p, sig) => {
      origSendSignal(p, sig);
      if (sig === "SIGTERM") {
        writeResult(out.runDir, {
          runId: out.runId,
          name: out.name,
          status: "failed",
          finishedAt: new Date().toISOString(),
          errorMessage: "interrupted",
        });
        const s = readStatus(out.runDir)!;
        s.status = "failed";
        s.terminalAt = new Date().toISOString();
        writeStatus(out.runDir, s);
        launcher.kill(p);
      }
    };

    const result = await runtime.stopRun(out.runId);
    // Should respect the child's terminal state
    expect(result.status).toBe("failed");
  });

  it("writes result.json on parent-driven stop", async () => {
    const out = await runtime.spawnRun({ prompt: "no child result" });
    await runtime.stopRun(out.runId);

    const result = readResult(out.runDir);
    expect(result).toBeDefined();
    expect(result!.status).toBe("stopped");
    expect(result!.finishedAt).toBeDefined();
  });
});

// ── removeRun ──

describe("removeRun", () => {
  it("removes a terminal run directory", async () => {
    const out = await runtime.spawnRun({ prompt: "remove me" });
    await runtime.stopRun(out.runId);
    expect(existsSync(out.runDir)).toBe(true);

    await runtime.removeRun(out.runId);
    expect(existsSync(out.runDir)).toBe(false);
  });

  it("rejects removal of running run", async () => {
    const out = await runtime.spawnRun({ prompt: "still running" });
    await expect(runtime.removeRun(out.runId)).rejects.toThrow(/non-terminal/);
    expect(existsSync(out.runDir)).toBe(true);
  });

  it("throws for nonexistent run", async () => {
    await expect(runtime.removeRun("ghost")).rejects.toThrow(/not found/);
  });

  it("removes completed runs", async () => {
    const out = await runtime.spawnRun({ prompt: "will complete" });
    const status = readStatus(out.runDir)!;
    launcher.kill(status.pid!);

    writeResult(out.runDir, {
      runId: out.runId,
      name: out.name,
      status: "completed",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
    });
    status.status = "completed";
    status.terminalAt = new Date().toISOString();
    writeStatus(out.runDir, status);

    await runtime.removeRun(out.runId);
    expect(existsSync(out.runDir)).toBe(false);
  });

  it("removes failed runs", async () => {
    const out = await runtime.spawnRun({ prompt: "will fail" });
    const status = readStatus(out.runDir)!;
    launcher.kill(status.pid!);

    // Reconcile to mark failed
    await runtime.reconcileRun(out.runId);

    await runtime.removeRun(out.runId);
    expect(existsSync(out.runDir)).toBe(false);
  });

  it("reconciles stale running status before rejecting", async () => {
    const out = await runtime.spawnRun({ prompt: "crashed" });
    const status = readStatus(out.runDir)!;
    // Process dies but status.json still says running
    launcher.kill(status.pid!);

    // Without reconcile-first, this would throw non-terminal
    await runtime.removeRun(out.runId);
    expect(existsSync(out.runDir)).toBe(false);
  });
});

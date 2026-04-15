/**
 * Integration tests for session-scoped envoy listing.
 *
 * Exercises the data flow: session entries → extractSpawnedRunIds → getRun
 * using a real SessionManager.inMemory() and EnvoyRuntime with FakeLauncher.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { FakeLauncher } from "../src/process.js";
import { EnvoyRuntime } from "../src/runtime.js";
import { extractSpawnedRunIds } from "../src/session-scope.js";
import { readStatus, writeResult } from "../src/store.js";
import type { ListEnvoysEntry } from "../src/types.js";

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
let sm: SessionManager;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-scope-"));
  launcher = new FakeLauncher();
  runtime = new EnvoyRuntime(tmpRoot, launcher, FAST_TIMINGS);
  sm = SessionManager.inMemory("/tmp/test");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Reproduce the list_envoys session-scoped code path:
 * getBranch() → extractSpawnedRunIds() → Promise.allSettled(getRun) → ListEnvoysEntry[]
 */
async function listSessionScoped(): Promise<ListEnvoysEntry[]> {
  const branch = sm.getBranch();
  const runIds = extractSpawnedRunIds(branch);

  const settled = await Promise.allSettled(
    runIds.map((id) => runtime.getRun(id)),
  );
  const runs: ListEnvoysEntry[] = [];
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    const info = entry.value;
    runs.push({
      runId: info.runId,
      name: info.name,
      status: info.status,
      startedAt: info.startedAt,
      lastActivityAt: info.lastActivityAt,
      runDir: info.runDir,
      model: info.model,
    });
  }
  return runs;
}

/** Simulate what spawn_envoy does: spawn + record in session */
async function spawnAndRecord(prompt: string) {
  const out = await runtime.spawnRun({ prompt });
  sm.appendCustomEntry("envoy_spawn", { runId: out.runId });
  return out;
}

describe("session-scoped listing", () => {
  it("returns only session-known runs", async () => {
    const a = await spawnAndRecord("task a");
    const b = await spawnAndRecord("task b");
    // c is in the store but NOT recorded in the session
    await runtime.spawnRun({ prompt: "task c" });

    const runs = await listSessionScoped();
    const ids = runs.map((r) => r.runId);

    expect(runs).toHaveLength(2);
    expect(ids).toContain(a.runId);
    expect(ids).toContain(b.runId);
  });

  it("skips removed runs gracefully", async () => {
    const a = await spawnAndRecord("task a");
    const b = await spawnAndRecord("will be removed");

    // Stop b so it's terminal, then remove it
    const statusB = readStatus(b.runDir)!;
    launcher.kill(statusB.pid!);
    await runtime.stopRun(b.runId);
    await runtime.removeRun(b.runId);

    const runs = await listSessionScoped();

    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe(a.runId);
  });

  it("reconciles stale status during session-scoped list", async () => {
    const a = await spawnAndRecord("will complete");
    const status = readStatus(a.runDir)!;

    // Simulate: child wrote result.json then died
    writeResult(a.runDir, {
      runId: a.runId,
      name: a.name,
      status: "completed",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      finalText: "Done.",
    });
    launcher.kill(status.pid!);

    const runs = await listSessionScoped();

    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
  });
});

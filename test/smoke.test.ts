/**
 * Opt-in smoke test for the real PiLauncher end-to-end path.
 *
 * Skipped by default. Enable with:
 *   PI_ENVOYS_SMOKE=1 npx vitest run test/smoke.test.ts
 *
 * Requires:
 * - `pi` CLI available (or running inside a pi process)
 * - A working model provider with API key configured
 *
 * What it tests:
 * - PiLauncher spawns a detached child pi process
 * - Child loads the extension via -e, picks up --envoy flag
 * - Recorder writes recorderStartedAt
 * - Prompt transport: input event transforms "." to real prompt
 * - Child finalizes to terminal state with result.json
 * - stderr.log is created
 * - remove cleans up
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PiLauncher } from "../src/process.js";
import { EnvoyRuntime } from "../src/runtime.js";
import { readResult, readStatus } from "../src/store.js";

const SMOKE_ENABLED = process.env.PI_ENVOYS_SMOKE === "1";
const TIMEOUT_MS = 120_000; // 2 minutes for model response

describe.skipIf(!SMOKE_ENABLED)("smoke: real PiLauncher", () => {
  let storeRoot: string;
  let runtime: EnvoyRuntime;

  beforeAll(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "pi-envoys-smoke-"));
    // When running under vitest (not inside pi), getPiInvocation would
    // resolve to the vitest script. Use explicit "pi" command instead.
    const extensionDir = join(import.meta.dirname, "..", "src");
    const launcher = new PiLauncher(extensionDir, { command: "pi", args: [] });
    runtime = new EnvoyRuntime(storeRoot, launcher);
  });

  afterAll(() => {
    if (storeRoot && existsSync(storeRoot)) {
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });

  it(
    "spawns, completes, and removes a trivial envoy",
    async () => {
      // Spawn
      const out = await runtime.spawnRun({
        prompt: 'Respond with exactly: "hello from envoy"',
      });

      expect(out.status).toBe("running");
      expect(out.runId).toBeDefined();
      expect(out.runDir).toBeDefined();
      expect(existsSync(out.runDir)).toBe(true);

      console.log(`Spawned envoy: ${out.name} (${out.runId})`);
      console.log(`Run directory: ${out.runDir}`);

      // Poll until terminal
      const deadline = Date.now() + TIMEOUT_MS;
      let status = readStatus(out.runDir);

      while (Date.now() < deadline) {
        status = readStatus(out.runDir);
        if (
          status &&
          ["completed", "failed", "stopped"].includes(status.status)
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }

      console.log(`Final status: ${status?.status}`);

      // Verify terminal state
      expect(status).toBeDefined();
      expect(["completed", "failed", "stopped"]).toContain(status!.status);

      // Verify recorderStartedAt was written (proves recorder loaded)
      expect(status!.recorderStartedAt).toBeDefined();
      console.log(`Recorder started at: ${status!.recorderStartedAt}`);

      // Verify result.json
      const result = readResult(out.runDir);
      expect(result).toBeDefined();
      expect(result!.runId).toBe(out.runId);
      expect(result!.finishedAt).toBeDefined();
      console.log(`Result status: ${result!.status}`);
      if (result!.finalText) {
        console.log(`Final text: ${result!.finalText.slice(0, 200)}`);
      }
      if (result!.errorMessage) {
        console.log(`Error: ${result!.errorMessage}`);
      }

      // Verify stderr.log exists (even if empty)
      const stderrPath = join(out.runDir, "stderr.log");
      expect(existsSync(stderrPath)).toBe(true);
      const stderr = readFileSync(stderrPath, "utf-8");
      if (stderr.trim()) {
        console.log(`stderr.log:\n${stderr.slice(0, 500)}`);
      }

      // Verify status.json finalization ordering
      expect(status!.finalizingAt).toBeDefined();
      expect(status!.terminalAt).toBeDefined();

      // Remove
      await runtime.removeRun(out.runId);
      expect(existsSync(out.runDir)).toBe(false);
      console.log("Removed successfully.");
    },
    TIMEOUT_MS + 10_000,
  );
});

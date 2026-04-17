import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { allocateRunId, generateName } from "./naming.js";
import type { EnvoyLauncher } from "./process.js";
import {
  createRunDir,
  listRunIds,
  promptPath,
  readResult,
  readStatus,
  removeRunDir,
  writeRequest,
  writeResult,
  writeStatus,
} from "./store.js";
import type {
  GetEnvoyOutput,
  ListEnvoysEntry,
  RequestFile,
  ResultFile,
  SpawnEnvoyInput,
  SpawnEnvoyOutput,
  StatusFile,
  WaitEnvoysOutput,
} from "./types.js";
import { canTransition, isTerminal } from "./types.js";

// ── Timing defaults ──

export interface RuntimeTimings {
  /** Grace period (ms) between SIGTERM and SIGKILL during stop */
  stopGraceMs: number;
  /** Max time (ms) to wait for finalization after pid death */
  finalizeWaitMs: number;
  /** Poll interval (ms) during finalization wait */
  finalizePollMs: number;
  /** Poll interval (ms) to check liveness after SIGTERM */
  stopPollMs: number;
  /** Poll interval (ms) for waitRuns */
  waitPollMs: number;
}

export const DEFAULT_TIMINGS: RuntimeTimings = {
  stopGraceMs: 5_000,
  finalizeWaitMs: 3_000,
  finalizePollMs: 200,
  stopPollMs: 250,
  waitPollMs: 2_000,
};

// ── Runtime ──

export class EnvoyRuntime {
  private readonly timings: RuntimeTimings;

  constructor(
    private readonly storeRoot: string,
    private readonly launcher: EnvoyLauncher,
    timings?: Partial<RuntimeTimings>,
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  // ── spawn ──

  async spawnRun(input: SpawnEnvoyInput): Promise<SpawnEnvoyOutput> {
    const runId = allocateRunId();
    const name = generateName();
    const now = new Date().toISOString();

    const runDir = createRunDir(this.storeRoot, runId);

    const request: RequestFile = {
      runId,
      name,
      createdAt: now,
    };
    writeRequest(runDir, request);

    // Write prompt as a standalone file — used as @file arg for the child
    writeFileSync(promptPath(runDir), input.prompt, "utf-8");

    const status: StatusFile = {
      runId,
      name,
      status: "running",
      startedAt: now,
      lastActivityAt: now,
    };
    writeStatus(runDir, status);

    const { pid } = await this.launcher.launch(request, runDir);

    // Persist pid into status
    status.pid = pid;
    status.lastActivityAt = new Date().toISOString();
    writeStatus(runDir, status);

    return { runId, name, status: "running", runDir };
  }

  // ── list ──

  async listRuns(): Promise<ListEnvoysEntry[]> {
    const ids = listRunIds(this.storeRoot);
    const entries: ListEnvoysEntry[] = [];

    for (const runId of ids) {
      const runDir = join(this.storeRoot, runId);
      // Reconcile each run to ensure status reflects reality
      let status: StatusFile | undefined;
      try {
        status = await this.reconcileRun(runId);
      } catch {
        // reconcile failed (e.g. corrupt run dir) — try raw read
        status = readStatus(runDir) ?? undefined;
      }
      if (!status) continue;

      entries.push({
        runId: status.runId,
        name: status.name,
        status: status.status,
        startedAt: status.startedAt,
        lastActivityAt: status.lastActivityAt,
        runDir,
      });
    }

    return entries;
  }

  // ── get ──

  async getRun(runId: string): Promise<GetEnvoyOutput> {
    const runDir = join(this.storeRoot, runId);
    const status = await this.reconcileRun(runId);

    const output: GetEnvoyOutput = {
      runId: status.runId,
      name: status.name,
      status: status.status,
      startedAt: status.startedAt,
      lastActivityAt: status.lastActivityAt,
      runDir,
    };

    if (isTerminal(status.status)) {
      const result = readResult(runDir);
      if (result) {
        output.result = {
          finalText: result.finalText,
          errorMessage: result.errorMessage,
          exitCode: result.exitCode,
          usage: result.usage,
        };
      }
    }

    return output;
  }

  // ── reconcile ──

  /**
   * Reconcile a single run's persisted state with process liveness.
   *
   * Rules:
   * 1. Already terminal → return as-is
   * 2. Pid alive → keep running
   * 3. Pid dead + result.json exists → sync status from result
   * 4. Pid dead + recent finalizingAt → bounded wait for result
   * 5. Pid dead + no terminal artifacts → failed (or stopped if signal evidence)
   */
  async reconcileRun(runId: string): Promise<StatusFile> {
    const runDir = join(this.storeRoot, runId);
    let status = readStatus(runDir);
    if (!status) {
      throw new Error(`Run ${runId}: status.json not found`);
    }

    // Rule 1: already terminal
    if (isTerminal(status.status)) return status;

    const pid = status.pid;
    if (pid == null) {
      // No pid recorded — launch must have failed before pid was written
      return this.markTerminal(runDir, status, "failed", {
        errorMessage: "No pid recorded — launch failed before process started",
      });
    }

    // Rule 2: pid alive
    if (this.launcher.isAlive(pid)) return status;

    // Pid is dead from here on
    status.lastActivityAt = new Date().toISOString();
    writeStatus(runDir, status);

    // Rule 3: result.json exists → sync
    const result = readResult(runDir);
    if (result) {
      return this.syncStatusFromResult(runDir, status, result);
    }

    // Rule 4: finalizingAt is recent → bounded wait
    if (status.finalizingAt) {
      const finalizingAge =
        Date.now() - new Date(status.finalizingAt).getTime();
      if (finalizingAge < this.timings.finalizeWaitMs) {
        const waited = await this.waitForResult(
          runDir,
          this.timings.finalizeWaitMs - finalizingAge,
        );
        if (waited) {
          status = readStatus(runDir)!;
          if (isTerminal(status.status)) return status;
          return this.syncStatusFromResult(runDir, status, waited);
        }
      }
    }

    // Rule 5: no terminal artifacts — determine terminal status
    if (this.hasStopSignalEvidence(status)) {
      return this.markTerminal(runDir, status, "stopped");
    }

    return this.markTerminal(runDir, status, "failed", {
      errorMessage: "Process exited without producing a result",
    });
  }

  // ── stop ──

  async stopRun(runId: string): Promise<StatusFile> {
    const runDir = join(this.storeRoot, runId);

    // Reconcile first to get current truth
    let status = await this.reconcileRun(runId);
    if (isTerminal(status.status)) return status;

    const pid = status.pid!;

    // Mark stop requested
    status.lastActivityAt = new Date().toISOString();
    writeStatus(runDir, status);

    // SIGTERM
    this.launcher.sendSignal(pid, "SIGTERM");
    status.termSignalSentAt = new Date().toISOString();
    status.lastActivityAt = new Date().toISOString();
    writeStatus(runDir, status);

    // Wait grace period for clean exit
    const died = await this.waitForDeath(pid, this.timings.stopGraceMs);

    if (!died) {
      // Escalate to SIGKILL
      this.launcher.sendSignal(pid, "SIGKILL");
      status.killSignalSentAt = new Date().toISOString();
      status.lastActivityAt = new Date().toISOString();
      writeStatus(runDir, status);

      // Brief wait after SIGKILL
      await this.waitForDeath(pid, 1_000);
    }

    // Reconcile again — child may have written its own terminal state
    status = await this.reconcileRun(runId);
    if (isTerminal(status.status)) return status;

    // Child didn't finalize — parent writes terminal stopped
    return this.markTerminal(runDir, status, "stopped");
  }

  // ── remove ──

  async removeRun(runId: string): Promise<void> {
    const runDir = join(this.storeRoot, runId);
    const status = readStatus(runDir);
    if (!status) {
      throw new Error(`Run ${runId}: not found`);
    }

    // Reconcile before checking precondition — on-disk status may be stale
    const reconciled = await this.reconcileRun(runId);
    if (!isTerminal(reconciled.status)) {
      throw new Error(
        `Run ${runId}: cannot remove non-terminal run (status: ${reconciled.status})`,
      );
    }
    removeRunDir(this.storeRoot, runId);
  }

  // ── wait ──

  /**
   * Block until one or all specified runs reach a terminal state.
   *
   * @param runIds - Run IDs to wait on
   * @param mode - "all" waits for every run; "any" waits for the first
   * @param timeoutMs - Max wait time in milliseconds
   * @param signal - AbortSignal for cancellation
   * @param onProgress - Called periodically with current state (for UI updates)
   */
  async waitRuns(
    runIds: string[],
    mode: "all" | "any",
    timeoutMs: number,
    signal?: AbortSignal,
    onProgress?: (results: GetEnvoyOutput[]) => void,
  ): Promise<WaitEnvoysOutput> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) break;

      const current = await this.getRunStates(runIds);

      const terminalCount = current.filter((r) => isTerminal(r.status)).length;
      const done =
        mode === "all" ? terminalCount === runIds.length : terminalCount > 0;

      onProgress?.(current);

      if (done) {
        return { timedOut: false, results: current };
      }

      // Poll interval — balance responsiveness vs disk I/O
      const remaining = deadline - Date.now();
      await sleep(Math.min(this.timings.waitPollMs, Math.max(0, remaining)));
    }

    // Timeout or aborted — return current state
    const final = await this.getRunStates(runIds);
    return { timedOut: !signal?.aborted, results: final };
  }

  private async getRunStates(runIds: string[]): Promise<GetEnvoyOutput[]> {
    const results: GetEnvoyOutput[] = [];
    for (const runId of runIds) {
      results.push(await this.getRun(runId));
    }
    return results;
  }

  // ── Private helpers ──

  private markTerminal(
    runDir: string,
    status: StatusFile,
    terminalStatus: "completed" | "failed" | "stopped",
    resultExtra?: Partial<ResultFile>,
  ): StatusFile {
    if (!canTransition(status.status, terminalStatus)) return status;

    const now = new Date().toISOString();

    // Write result.json
    const result: ResultFile = {
      runId: status.runId,
      name: status.name,
      status: terminalStatus,
      finishedAt: now,
      ...resultExtra,
    };
    writeResult(runDir, result);

    // Write terminal status.json
    status.status = terminalStatus;
    status.lastActivityAt = now;
    writeStatus(runDir, status);

    return status;
  }

  private syncStatusFromResult(
    runDir: string,
    status: StatusFile,
    result: ResultFile,
  ): StatusFile {
    if (!canTransition(status.status, result.status)) return status;

    status.status = result.status;
    status.lastActivityAt = new Date().toISOString();
    writeStatus(runDir, status);

    return status;
  }

  private hasStopSignalEvidence(status: StatusFile): boolean {
    return !!(status.termSignalSentAt || status.killSignalSentAt);
  }

  private async waitForResult(
    runDir: string,
    maxMs: number,
  ): Promise<ResultFile | undefined> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const result = readResult(runDir);
      if (result) return result;
      await sleep(Math.min(this.timings.finalizePollMs, deadline - Date.now()));
    }
    return readResult(runDir);
  }

  private async waitForDeath(pid: number, maxMs: number): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (!this.launcher.isAlive(pid)) return true;
      await sleep(Math.min(this.timings.stopPollMs, deadline - Date.now()));
    }
    return !this.launcher.isAlive(pid);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

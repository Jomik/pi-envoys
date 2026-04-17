import { readStatus, writeResult, writeStatus } from "./store.js";
import type { ResultFile, StatusFile } from "./types.js";

// ── Constants ──

/** Minimum interval (ms) between lastActivityAt writes */
const ACTIVITY_THROTTLE_MS = 500;

// ── Recorder ──

/**
 * Testable lifecycle recorder logic, independent of pi event hooks.
 *
 * The recorder observes the child run lifecycle and persists state
 * into the run directory. All terminal writes are guarded by finalizeOnce().
 */
export class RecorderCore {
  private finalized = false;
  private lastActivityWrite = 0;

  // Collected data for terminal result
  private finalText: string | undefined;
  private errorMessage: string | undefined;
  private model: string | undefined;
  private usage: Record<string, unknown> | undefined;
  private exitCode: number | undefined;
  private signal: string | undefined;

  constructor(private readonly runDir: string) {}

  // ── Lifecycle markers ──

  /** Update lastActivityAt on recorder start. Call from session_start. */
  markRecorderStarted(): void {
    const status = this.readStatusOrThrow();
    status.lastActivityAt = new Date().toISOString();
    writeStatus(this.runDir, status);
  }

  // ── Activity tracking ──

  /** Throttled update of lastActivityAt. */
  recordActivity(): void {
    const now = Date.now();
    if (now - this.lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityWrite = now;

    const status = this.readStatusOrThrow();
    status.lastActivityAt = new Date(now).toISOString();
    writeStatus(this.runDir, status);
  }

  // ── Data collection ──

  setFinalText(text: string): void {
    this.finalText = text;
  }

  setErrorMessage(message: string): void {
    this.errorMessage = message;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setUsage(usage: Record<string, unknown>): void {
    this.usage = usage;
  }

  setExitCode(code: number): void {
    this.exitCode = code;
  }

  setSignal(sig: string): void {
    this.signal = sig;
  }

  // ── Terminal finalization ──

  /**
   * Determine terminal status from collected evidence.
   *
   * `stopped` requires parent stop evidence in status.json (termSignalSentAt
   * or killSignalSentAt). Receiving a signal (SIGTERM, SIGINT) from any other
   * source does not justify `stopped` — only an explicit stop_envoy flow does.
   */
  private resolveTerminalStatus(): "completed" | "failed" | "stopped" {
    // Parent stop evidence → stopped
    const status = readStatus(this.runDir);
    if (status?.termSignalSentAt || status?.killSignalSentAt) {
      return "stopped";
    }

    // Error evidence → failed
    if (this.errorMessage) return "failed";
    if (this.exitCode !== undefined && this.exitCode !== 0) return "failed";

    // Signal without parent evidence → failed (external kill, Ctrl+C, etc.)
    if (this.signal) return "failed";

    // Clean exit → completed
    return "completed";
  }

  /**
   * Finalize the run exactly once. Idempotent — subsequent calls are no-ops.
   *
   * Finalization order (per plan):
   * 1. Write status.finalizingAt
   * 2. Write result.json atomically
   * 3. Write terminal status.json
   */
  finalizeOnce(overrideStatus?: "completed" | "failed" | "stopped"): void {
    if (this.finalized) return;
    this.finalized = true;

    try {
      const status = this.readStatusOrThrow();

      // Already terminal — don't overwrite
      if (status.status !== "running") return;

      const terminalStatus = overrideStatus ?? this.resolveTerminalStatus();
      const now = new Date().toISOString();

      // Step 1: finalizingAt
      status.finalizingAt = now;
      status.lastActivityAt = now;
      writeStatus(this.runDir, status);

      // Step 2: result.json
      const result: ResultFile = {
        runId: status.runId,
        name: status.name,
        status: terminalStatus,
        finishedAt: now,
        exitCode: this.exitCode,
        signal: this.signal,
        finalText: this.finalText,
        errorMessage: this.errorMessage,
        model: this.model,
        usage: this.usage,
      };
      writeResult(this.runDir, result);

      // Step 3: terminal status.json
      status.status = terminalStatus;
      status.lastActivityAt = now;
      writeStatus(this.runDir, status);
    } catch {
      // Best-effort — if we can't write, parent reconciliation is the fallback
    }
  }

  get isFinalized(): boolean {
    return this.finalized;
  }

  // ── Helpers ──

  private readStatusOrThrow(): StatusFile {
    const status = readStatus(this.runDir);
    if (!status)
      throw new Error(`RecorderCore: status.json not found in ${this.runDir}`);
    return status;
  }
}

export { ACTIVITY_THROTTLE_MS };

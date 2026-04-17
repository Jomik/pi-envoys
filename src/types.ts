// ── Status model ──

export type RunStatus = "running" | "completed" | "failed" | "stopped";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "stopped",
]);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Returns `true` when the transition is allowed.
 *
 * Allowed:
 *   running → completed | failed | stopped
 *
 * No transition out of a terminal state.
 */
export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (isTerminal(from)) return false;
  // from === "running"
  return to !== "running";
}

// ── Persisted file shapes ──

/** `request.json` — immutable after creation */
export interface RequestFile {
  runId: string;
  name: string;
  createdAt: string; // ISO 8601
  agent?: string;
}

/** `status.json` — mutated throughout the run lifecycle */
export interface StatusFile {
  runId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  lastActivityAt: string;
  pid?: number;

  // Finalization marker
  finalizingAt?: string;

  // Stop-flow evidence
  termSignalSentAt?: string;
  killSignalSentAt?: string;
}

/** `result.json` — written once at terminal time */
export interface ResultFile {
  runId: string;
  name: string;
  status: "completed" | "failed" | "stopped";
  finishedAt: string;
  exitCode?: number;
  signal?: string;
  finalText?: string;
  errorMessage?: string;
  model?: string;
  usage?: Record<string, unknown>;
}

// ── Tool I/O types ──

export interface SpawnEnvoyInput {
  prompt: string;
  agent?: string;
}

export interface SpawnEnvoyOutput {
  runId: string;
  name: string;
  status: RunStatus;
  runDir: string;
}

export interface ListEnvoysEntry {
  runId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  lastActivityAt: string;
  runDir: string;
}

export interface GetEnvoyResult {
  finalText?: string;
  errorMessage?: string;
  exitCode?: number;
  usage?: Record<string, unknown>;
}

export interface GetEnvoyOutput {
  runId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  lastActivityAt: string;
  runDir: string;
  result?: GetEnvoyResult;
}

export interface StopEnvoyInput {
  runId: string;
}

export interface RemoveEnvoyInput {
  runId: string;
}

export interface WaitEnvoysOutput {
  timedOut: boolean;
  results: GetEnvoyOutput[];
}

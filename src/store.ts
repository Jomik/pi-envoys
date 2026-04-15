import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { RequestFile, ResultFile, StatusFile } from "./types.js";

// ── Run store root ──

/**
 * Resolve the run store root directory.
 *
 * Uses `getAgentDir()` from pi-coding-agent which respects
 * `PI_CODING_AGENT_DIR` env var, falling back to `~/.pi/agent/`.
 *
 * Result: `<agentDir>/envoys/runs/`
 */
export function resolveRunStoreRoot(): string {
  return join(getAgentDir(), "envoys", "runs");
}

// ── Run directory ──

/**
 * Create the run directory under the store root.
 * Returns the absolute path.
 */
export function createRunDir(storeRoot: string, runId: string): string {
  const runDir = join(storeRoot, runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

// ── Atomic JSON writes ──

/**
 * Atomically write a JSON file: write to a temp sibling, then rename.
 * This avoids partial reads from concurrent observers.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Read and parse a JSON file. Returns `undefined` if the file does not exist.
 */
export function readJsonOrUndefined<T>(filePath: string): T | undefined {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

// ── Per-run file helpers ──

export function requestPath(runDir: string): string {
  return join(runDir, "request.json");
}

export function statusPath(runDir: string): string {
  return join(runDir, "status.json");
}

export function resultPath(runDir: string): string {
  return join(runDir, "result.json");
}

export function stderrLogPath(runDir: string): string {
  return join(runDir, "stderr.log");
}

export function writeRequest(runDir: string, data: RequestFile): void {
  writeJsonAtomic(requestPath(runDir), data);
}

export function readRequest(runDir: string): RequestFile | undefined {
  return readJsonOrUndefined<RequestFile>(requestPath(runDir));
}

export function writeStatus(runDir: string, data: StatusFile): void {
  writeJsonAtomic(statusPath(runDir), data);
}

export function readStatus(runDir: string): StatusFile | undefined {
  return readJsonOrUndefined<StatusFile>(statusPath(runDir));
}

export function writeResult(runDir: string, data: ResultFile): void {
  writeJsonAtomic(resultPath(runDir), data);
}

export function readResult(runDir: string): ResultFile | undefined {
  return readJsonOrUndefined<ResultFile>(resultPath(runDir));
}

// ── List / remove ──

/**
 * List all run IDs under the store root (directory names).
 * Returns an empty array if the store root does not exist.
 */
export function listRunIds(storeRoot: string): string[] {
  try {
    return readdirSync(storeRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Remove an entire run directory.
 */
export function removeRunDir(storeRoot: string, runId: string): void {
  const runDir = join(storeRoot, runId);
  rmSync(runDir, { recursive: true, force: true });
}

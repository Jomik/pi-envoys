import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { promptPath, stderrLogPath } from "./store.js";
import type { RequestFile } from "./types.js";

// ── Launcher interface ──

export interface LaunchResult {
  pid: number;
}

/**
 * Abstraction over child process spawning, liveness checks, and signaling.
 * Implementations: FakeLauncher (tests), PiLauncher (production, Phase C).
 */
export interface EnvoyLauncher {
  launch(request: RequestFile, runDir: string): Promise<LaunchResult>;
  isAlive(pid: number): boolean;
  sendSignal(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
}

// ── FakeLauncher for tests ──

export class FakeLauncher implements EnvoyLauncher {
  /** Set of pids currently considered alive */
  readonly alivePids = new Set<number>();

  /** Signals received: pid → signal[] */
  readonly signals = new Map<number, Array<"SIGTERM" | "SIGKILL">>();

  private nextPid = 90000;

  async launch(_request: RequestFile, _runDir: string): Promise<LaunchResult> {
    const pid = this.nextPid++;
    this.alivePids.add(pid);
    return { pid };
  }

  isAlive(pid: number): boolean {
    return this.alivePids.has(pid);
  }

  sendSignal(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    if (!this.signals.has(pid)) {
      this.signals.set(pid, []);
    }
    this.signals.get(pid)!.push(signal);

    // SIGKILL always kills in the fake
    if (signal === "SIGKILL") {
      this.alivePids.delete(pid);
    }
  }

  /** Test helper: simulate process death */
  kill(pid: number): void {
    this.alivePids.delete(pid);
  }
}

// ── PiLauncher (production) ──

/**
 * Resolve the `pi` CLI invocation.
 * Follows the subagent `getPiInvocation` pattern:
 * - If running inside a pi process, re-use process.execPath + process.argv[1]
 * - Otherwise fall back to bare "pi" binary
 */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = (process.execPath.split("/").pop() ?? "").toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

/**
 * Real launcher that spawns a detached `pi` subprocess.
 *
 * Requires `extensionDir` — the directory containing this extension's source,
 * used to resolve the `-e` path for the child process.
 *
 * `getPiInvocation` resolves the pi CLI correctly when running inside a pi
 * process. For testing outside pi, pass an explicit `piCommand` override.
 */
export class PiLauncher implements EnvoyLauncher {
  constructor(
    private readonly extensionDir: string,
    private readonly piCommand?: { command: string; args: string[] },
  ) {}

  async launch(_request: RequestFile, runDir: string): Promise<LaunchResult> {
    const piArgs: string[] = [
      "-p",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "-e",
      join(this.extensionDir, "index.ts"),
      "--envoy",
      runDir,
    ];

    // Pass prompt via @file so pi reads it natively
    piArgs.push(`@${promptPath(runDir)}`);

    const invocation = this.piCommand
      ? {
          command: this.piCommand.command,
          args: [...this.piCommand.args, ...piArgs],
        }
      : getPiInvocation(piArgs);

    const stderrFd = openSync(stderrLogPath(runDir), "w");

    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: ["ignore", "ignore", stderrFd],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const pid = child.pid;
    if (pid == null) {
      throw new Error("Failed to spawn child process: no pid returned");
    }

    child.unref();

    return { pid };
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  sendSignal(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already dead
    }
  }
}

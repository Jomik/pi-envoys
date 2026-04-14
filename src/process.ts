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

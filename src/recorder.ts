import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RecorderCore } from "./recorder-core.js";

// ── Child mode: recorder ──

export function initRecorder(pi: ExtensionAPI, runDir: string): void {
  const recorder = new RecorderCore(runDir);

  // Mark recorder started immediately
  recorder.markRecorderStarted();

  // Activity tracking
  pi.on("agent_start", () => {
    recorder.recordActivity();
  });

  pi.on("message_update", (event) => {
    recorder.recordActivity();

    // Collect assistant text incrementally
    if (event.message.role === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") {
          recorder.setFinalText(part.text);
        }
      }
    }
  });

  pi.on("message_end", (event) => {
    recorder.recordActivity();

    // Collect model and usage from assistant messages
    if (event.message.role === "assistant") {
      const msg = event.message;
      if (msg.model) recorder.setModel(msg.model);
      if (msg.usage) {
        recorder.setUsage({
          input: msg.usage.input,
          output: msg.usage.output,
          cacheRead: msg.usage.cacheRead,
          cacheWrite: msg.usage.cacheWrite,
          cost: msg.usage.cost,
          totalTokens: msg.usage.totalTokens,
        });
      }
      if (msg.errorMessage) recorder.setErrorMessage(msg.errorMessage);

      // Collect final text
      for (const part of msg.content) {
        if (part.type === "text") {
          recorder.setFinalText(part.text);
        }
      }
    }
  });

  pi.on("tool_execution_start", () => {
    recorder.recordActivity();
  });

  pi.on("tool_execution_end", () => {
    recorder.recordActivity();
  });

  // Agent end — collect final state
  pi.on("agent_end", (event) => {
    recorder.recordActivity();

    // Extract final assistant text from the last assistant message
    for (let i = event.messages.length - 1; i >= 0; i--) {
      const msg = event.messages[i];
      if (msg.role === "assistant") {
        for (const part of msg.content) {
          if (part.type === "text") {
            recorder.setFinalText(part.text);
            break;
          }
        }
        break;
      }
    }

    // Clean exit
    recorder.setExitCode(0);
  });

  // Session shutdown — finalize
  pi.on("session_shutdown", () => {
    recorder.finalizeOnce();
  });

  // Failure-path finalization hooks
  //
  // Installing handlers for SIGTERM/SIGINT/uncaughtException suppresses
  // Node's default termination. We must process.exit() after finalizing
  // to avoid leaving a zombie process with terminal files on disk.

  process.on("uncaughtException", (err) => {
    recorder.setErrorMessage(`uncaughtException: ${err.message}`);
    recorder.setExitCode(1);
    recorder.finalizeOnce("failed");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    recorder.setErrorMessage(`unhandledRejection: ${reason}`);
    recorder.setExitCode(1);
    recorder.finalizeOnce("failed");
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    recorder.setSignal("SIGTERM");
    recorder.finalizeOnce(); // resolveTerminalStatus checks parent stop evidence
    process.exit(143); // 128 + 15 (SIGTERM)
  });

  process.on("SIGINT", () => {
    recorder.setSignal("SIGINT");
    recorder.finalizeOnce(); // resolveTerminalStatus checks parent stop evidence
    process.exit(130); // 128 + 2 (SIGINT)
  });

  process.on("exit", (code) => {
    if (code != null) recorder.setExitCode(code);
    recorder.finalizeOnce();
  });
}

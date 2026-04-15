import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { RecorderCore } from "./recorder-core.js";
import { PiLauncher } from "./process.js";
import { EnvoyRuntime } from "./runtime.js";
import { resolveRunStoreRoot } from "./store.js";
import type { ListEnvoysEntry, SpawnEnvoyOutput } from "./types.js";
import type { StatusFile } from "./types.js";

/**
 * @jomik/pi-envoys
 *
 * Extension entry point. Bifurcates on `--envoy` flag:
 * - Parent mode (no --envoy): registers tools in session_start
 * - Child mode (--envoy <runDir>): inits recorder in session_start
 */
export default function (pi: ExtensionAPI) {
  pi.registerFlag("envoy", {
    type: "string",
    description: "Run directory for envoy child mode (internal)",
  });

  pi.on("session_start", async (_event, _ctx) => {
    const runDir = pi.getFlag("envoy") as string | undefined;
    if (runDir) {
      initRecorder(pi, runDir);
    } else {
      registerTools(pi);
    }
  });
}

// ── Parent mode: tools ──

function registerTools(pi: ExtensionAPI): void {
  const storeRoot = resolveRunStoreRoot();
  const launcher = new PiLauncher(import.meta.dirname);
  const runtime = new EnvoyRuntime(storeRoot, launcher);

  // ── spawn_envoy ──

  pi.registerTool({
    name: "spawn_envoy",
    label: "Spawn Envoy",
    description:
      "Start a fresh isolated envoy run. The envoy executes the given prompt in a separate pi subprocess with its own context.",
    promptSnippet: "spawn_envoy: start an isolated agent run with an explicit prompt",
    promptGuidelines: [
      "Envoys run in isolated subprocesses with no access to this conversation's context.",
      "Envoy prompts must be fully self-contained: include all file paths, requirements, and relevant context.",
      "Use envoys for independent, parallelizable work. Spawn multiple envoys for tasks that don't depend on each other.",
      "After spawning, poll with list_envoys until status is terminal, then use get_envoy to read the result.",
      "Do not spawn an envoy for work that depends on another envoy's output. Wait for the first to complete, inspect its result, then proceed.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Exact task payload for the envoy run" }),
      model: Type.Optional(Type.String({ description: "Model selector for the subprocess" })),
      cwd: Type.Optional(Type.String({ description: "Working directory for the subprocess" })),
    }),
    async execute(_toolCallId, params) {
      const result = await runtime.spawnRun({
        prompt: params.prompt,
        model: params.model,
        cwd: params.cwd,
      });
      return {
        content: [
          {
            type: "text",
            text: [
              `Envoy spawned: ${result.name} (${result.runId})`,
              `Status: ${result.status}`,
              `Run directory: ${result.runDir}`,
            ].join("\n"),
          },
        ],
        details: result,
      };
    },
  });

  // ── list_envoys ──

  pi.registerTool({
    name: "list_envoys",
    label: "List Envoys",
    description: "List known envoy runs from the local run store.",
    promptSnippet: "list_envoys: list known envoy runs and their statuses",
    promptGuidelines: [
      "Use list_envoys to poll envoy progress after spawning. A run is done when its status is completed, failed, or stopped.",
      "To inspect an envoy's output, use get_envoy with its runId.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const runs = await runtime.listRuns();
      if (runs.length === 0) {
        return {
          content: [{ type: "text", text: "No envoy runs found." }],
          details: [] as ListEnvoysEntry[],
        };
      }

      const lines = runs.map((r) => {
        const parts = [
          `${r.name} (${r.runId})`,
          `status: ${r.status}`,
          `started: ${r.startedAt}`,
          `activity: ${r.lastActivityAt}`,
        ];
        if (r.model) parts.push(`model: ${r.model}`);
        parts.push(`dir: ${r.runDir}`);
        return parts.join("  |  ");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: runs,
      };
    },
  });

  // ── get_envoy ──

  pi.registerTool({
    name: "get_envoy",
    label: "Get Envoy",
    description:
      "Return the full state of a single envoy identified by runId, including its result when terminal.",
    promptSnippet: "get_envoy: inspect an envoy's status, prompt, and result",
    promptGuidelines: [
      "Use get_envoy to inspect an envoy's result after it reaches a terminal state. The result includes finalText (the envoy's response), errorMessage, exitCode, and usage.",
    ],
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID of the envoy to inspect" }),
    }),
    async execute(_toolCallId, params) {
      const info = await runtime.getRun(params.runId);

      const lines = [
        `${info.name} (${info.runId})`,
        `Status: ${info.status}`,
        `Started: ${info.startedAt}`,
        `Activity: ${info.lastActivityAt}`,
      ];
      if (info.model) lines.push(`Model: ${info.model}`);
      if (info.prompt) {
        const preview = info.prompt.length > 200
          ? info.prompt.slice(0, 200) + "..."
          : info.prompt;
        lines.push(`Prompt: ${preview}`);
      }
      if (info.result) {
        if (info.result.finalText) lines.push(`\nResult:\n${info.result.finalText}`);
        if (info.result.errorMessage) lines.push(`Error: ${info.result.errorMessage}`);
        if (info.result.exitCode != null) lines.push(`Exit code: ${info.result.exitCode}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: info,
      };
    },
  });

  // ── stop_envoy ──

  pi.registerTool({
    name: "stop_envoy",
    label: "Stop Envoy",
    description:
      "Stop a running envoy identified by runId. Sends a graceful stop signal, waits, then force-kills if needed.",
    promptSnippet: "stop_envoy: stop a running envoy by runId",
    promptGuidelines: [
      "Only stop an envoy if the user requests it or the task is no longer needed. Do not stop envoys that are still making useful progress.",
    ],
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID of the envoy to stop" }),
    }),
    async execute(_toolCallId, params) {
      const status = await runtime.stopRun(params.runId);
      return {
        content: [
          {
            type: "text",
            text: `Envoy ${status.name} (${status.runId}): ${status.status}`,
          },
        ],
        details: status,
      };
    },
  });

  // ── remove_envoy ──

  pi.registerTool({
    name: "remove_envoy",
    label: "Remove Envoy",
    description:
      "Remove a terminal envoy from the local run store. The run must be in a terminal state (completed, failed, or stopped). Reconciles stale status before checking.",
    promptSnippet: "remove_envoy: remove a terminal envoy run by runId",
    promptGuidelines: [
      "Always read and acknowledge an envoy's result before removing it. Removal deletes all run files permanently.",
    ],
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID of the envoy to remove" }),
    }),
    async execute(_toolCallId, params) {
      await runtime.removeRun(params.runId);
      return {
        content: [{ type: "text", text: `Envoy ${params.runId} removed.` }],
        details: { runId: params.runId },
      };
    },
  });
}

// ── Child mode: recorder ──

function initRecorder(pi: ExtensionAPI, runDir: string): void {
  const recorder = new RecorderCore(runDir);

  // Mark recorder started immediately
  recorder.markRecorderStarted();

  // Prompt transform: replace dummy "." with real prompt from request.json
  pi.on("input", (event) => {
    if (event.text === ".") {
      const realPrompt = recorder.readPromptFromRequest();
      return { action: "transform" as const, text: realPrompt };
    }
  });

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

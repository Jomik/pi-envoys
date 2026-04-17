import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  discoverAgents,
  loadAgentDefinition,
  validateAgentForSpawn,
} from "./agents.js";
import {
  formatGetResult,
  formatListResult,
  formatRemoveResult,
  formatSpawnResult,
  formatStopResult,
  formatWaitResult,
} from "./format.js";
import { PiLauncher } from "./process.js";
import { initRecorder } from "./recorder.js";
import { EnvoyRuntime } from "./runtime.js";
import { extractSpawnedRunIds } from "./session-scope.js";
import { resolveRunStoreRoot } from "./store.js";
import type { ListEnvoysEntry, WaitEnvoysOutput } from "./types.js";

/**
 * pi-envoys
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

  // Discover agents at registration time for LLM visibility in promptGuidelines.
  // Re-runs on /reload (session_start fires again). Between reloads, new definitions
  // can still be used via loadAgentDefinition (reads from disk on each spawn).
  const agents = discoverAgents();
  const agentGuidelines: string[] = [];
  if (agents.length > 0) {
    const listing = agents.map((a) =>
      a.description ? `- ${a.name}: ${a.description}` : `- ${a.name}`,
    );
    agentGuidelines.push(
      `Available agents for spawn_envoy:\n${listing.join("\n")}`,
    );
  }

  pi.registerTool({
    name: "spawn_envoy",
    label: "Spawn Envoy",
    description:
      "Start a fresh isolated envoy run. The envoy executes the given prompt in a separate pi subprocess with its own context.",
    promptSnippet:
      "spawn_envoy: start an isolated agent run with an explicit prompt",
    promptGuidelines: [
      "Envoys run in isolated subprocesses with no access to this conversation's context.",
      "Envoy prompts must be fully self-contained: include all file paths, requirements, and relevant context.",
      "Use envoys for independent, parallelizable work. Call spawn_envoy once per task, then pass all runIds to wait_envoys.",
      "Use wait_envoys when you need results before continuing. Use list_envoys and get_envoy when you can do other work while envoys run.",
      "Do not spawn an envoy for work that depends on another envoy's output. Wait for the first to complete, inspect its result, then proceed.",
      ...agentGuidelines,
    ],
    parameters: Type.Object({
      prompt: Type.String({
        description: "Exact task payload for the envoy run",
      }),
      agent: Type.Optional(
        Type.String({
          description:
            "Agent definition name. Resolves to a named launch configuration that bundles role-specific behavior.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Resolve and validate agent definition if provided
      let agentDef: ReturnType<typeof loadAgentDefinition> | undefined;
      if (params.agent) {
        agentDef = loadAgentDefinition(params.agent);
        validateAgentForSpawn(agentDef, ctx.modelRegistry.getAvailable());
      }

      const result = await runtime.spawnRun(
        { prompt: params.prompt, agent: params.agent },
        agentDef,
      );

      // Record in session history for session-scoped visibility.
      // Best-effort: spawn succeeded regardless; the run is in the store.
      let sessionTrackingFailed = false;
      try {
        pi.appendEntry("envoy_spawn", { runId: result.runId });
      } catch {
        sessionTrackingFailed = true;
      }

      return formatSpawnResult(result, params.agent, sessionTrackingFailed);
    },
  });

  // ── list_envoys ──

  pi.registerTool({
    name: "list_envoys",
    label: "List Envoys",
    description:
      'List envoy runs. Defaults to runs spawned in the current session history; use scope "all" for the full run store.',
    promptSnippet:
      "list_envoys: list envoy runs scoped to this session (or all)",
    promptGuidelines: [
      'list_envoys defaults to scope "session", showing only envoys spawned in this conversation\'s history (including across resume and fork).',
      'Use scope "all" to see every run in the local store, including runs from other sessions.',
      "To inspect a specific envoy's output, use get_envoy with its runId.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("all")], {
          description: '"session" (default) or "all"',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = params.scope ?? "session";

      let runs: ListEnvoysEntry[];

      if (scope === "all") {
        runs = await runtime.listRuns();
      } else {
        // Walk session branch to find envoy_spawn entries
        const branch = ctx.sessionManager.getBranch();
        const runIds = extractSpawnedRunIds(branch);

        const settled = await Promise.allSettled(
          runIds.map((id) => runtime.getRun(id)),
        );
        runs = [];
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
          });
        }
      }

      return formatListResult(runs, scope);
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
      return formatGetResult(info);
    },
  });

  // ── wait_envoys ──

  pi.registerTool({
    name: "wait_envoys",
    label: "Wait Envoys",
    description:
      "Block until one or all specified envoys reach a terminal state. Returns the full state of all specified runs.",
    promptSnippet: "wait_envoys: block until envoys complete, fail, or stop",
    promptGuidelines: [
      'Use wait_envoys with mode "all" after spawning multiple envoys that you need results from before continuing.',
      'Use mode "any" when you only need the first result to proceed.',
      "Prefer wait_envoys over polling with list_envoys in a loop — it blocks cleanly without adding tool calls to the context.",
    ],
    parameters: Type.Object({
      runIds: Type.Array(Type.String(), { description: "Run IDs to wait on" }),
      mode: Type.Union([Type.Literal("all"), Type.Literal("any")], {
        description: '"all" waits for every run; "any" waits for the first',
      }),
      timeout: Type.Optional(
        Type.Number({
          description: "Max seconds to wait (default: 600)",
          default: 600,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const timeoutMs = (params.timeout ?? 600) * 1000;

      const result = await runtime.waitRuns(
        params.runIds,
        params.mode,
        timeoutMs,
        signal ?? undefined,
        (current) => {
          // Stream progress to UI without entering LLM context
          const summary = current.map(
            (r) =>
              `${r.name} (${r.runId}): ${r.status}  activity: ${r.lastActivityAt}`,
          );
          onUpdate?.({
            content: [{ type: "text", text: summary.join("\n") }],
            details: {
              timedOut: false,
              results: current,
            } satisfies WaitEnvoysOutput,
          });
        },
      );

      return formatWaitResult(result);
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
      return formatStopResult(status);
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
      return formatRemoveResult(params.runId);
    },
  });
}

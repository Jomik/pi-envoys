import type {
  GetEnvoyOutput,
  ListEnvoysEntry,
  SpawnEnvoyOutput,
  StatusFile,
  WaitEnvoysOutput,
} from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

export function formatSpawnResult(
  result: SpawnEnvoyOutput,
  agent: string | undefined,
  sessionTrackingFailed: boolean,
): ToolResult {
  const lines = [
    `Envoy spawned: ${result.name} (${result.runId})`,
    `Status: ${result.status}`,
    `Run directory: ${result.runDir}`,
  ];
  if (agent) {
    lines.push(`Agent: ${agent}`);
  }
  if (sessionTrackingFailed) {
    lines.push(
      '\u26a0 Failed to record in session history. Use list_envoys scope "all" to find this run.',
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: result,
  };
}

export function formatListResult(
  runs: ListEnvoysEntry[],
  scope: string,
): ToolResult {
  if (runs.length === 0) {
    const qualifier = scope === "session" ? " in this session" : "";
    return {
      content: [{ type: "text", text: `No envoy runs found${qualifier}.` }],
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
    parts.push(`dir: ${r.runDir}`);
    return parts.join("  |  ");
  });

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: runs,
  };
}

export function formatGetResult(info: GetEnvoyOutput): ToolResult {
  const lines = [
    `${info.name} (${info.runId})`,
    `Status: ${info.status}`,
    `Started: ${info.startedAt}`,
    `Activity: ${info.lastActivityAt}`,
  ];
  if (info.result) {
    if (info.result.finalText)
      lines.push(`\nResult:\n${info.result.finalText}`);
    if (info.result.errorMessage)
      lines.push(`Error: ${info.result.errorMessage}`);
    if (info.result.exitCode != null)
      lines.push(`Exit code: ${info.result.exitCode}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: info,
  };
}

export function formatWaitResult(result: WaitEnvoysOutput): ToolResult {
  const lines: string[] = [];
  if (result.timedOut)
    lines.push("\u26a0 Wait timed out. Returning current state.\n");

  for (const r of result.results) {
    lines.push(`${r.name} (${r.runId}): ${r.status}`);
    if (r.result?.finalText) {
      lines.push(r.result.finalText);
    }
    if (r.result?.errorMessage) {
      lines.push(`Error: ${r.result.errorMessage}`);
    }
    lines.push("");
  }

  return {
    content: [{ type: "text", text: lines.join("\n").trim() }],
    details: result,
  };
}

export function formatStopResult(status: StatusFile): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Envoy ${status.name} (${status.runId}): ${status.status}`,
      },
    ],
    details: status,
  };
}

export function formatRemoveResult(runId: string): ToolResult {
  return {
    content: [{ type: "text", text: `Envoy ${runId} removed.` }],
    details: { runId },
  };
}

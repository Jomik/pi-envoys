import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

// ── Constants ──

export const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/;

// ── Types ──

export interface AgentDefinition {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  thinking?: ThinkingLevel;
  body?: string;
  filePath: string;
}

// ── Internal helpers ──

function resolveAgentsDir(): string {
  return join(getAgentDir(), "agents");
}

function validateStringArray(
  value: unknown,
  fieldName: string,
  agentName: string,
): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(
      `Agent "${agentName}": field "${fieldName}" must be a string[]`,
    );
  }
  return value as string[];
}

// ── Public API ──

/**
 * Discover all agent definitions in the agents directory.
 * Files that fail to parse are silently skipped.
 */
export function discoverAgents(): AgentDefinition[] {
  const dir = resolveAgentsDir();
  if (!existsSync(dir)) return [];

  const results: AgentDefinition[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const name = basename(entry.name, ".md");
    try {
      results.push(loadAgentDefinition(name));
    } catch {
      // silently skip
    }
  }
  return results;
}

/**
 * Load and validate a single agent definition by name.
 */
export function loadAgentDefinition(name: string): AgentDefinition {
  if (!AGENT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid agent name: "${name}" (must match ${AGENT_NAME_RE})`,
    );
  }

  const filePath = join(resolveAgentsDir(), `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Agent definition not found: ${name}`);
  }

  const raw = readFileSync(filePath, "utf-8");

  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Agent "${name}": failed to parse frontmatter: ${msg}`);
  }

  const fm = parsed.frontmatter;

  // Validate scalar fields
  if (fm.description !== undefined && typeof fm.description !== "string") {
    throw new Error(`Agent "${name}": field "description" must be a string`);
  }
  if (fm.model !== undefined && typeof fm.model !== "string") {
    throw new Error(`Agent "${name}": field "model" must be a string`);
  }
  if (fm.thinking !== undefined && typeof fm.thinking !== "string") {
    throw new Error(`Agent "${name}": field "thinking" must be a string`);
  }

  // Validate array fields
  const tools =
    fm.tools !== undefined
      ? validateStringArray(fm.tools, "tools", name)
      : undefined;
  const skills =
    fm.skills !== undefined
      ? validateStringArray(fm.skills, "skills", name)
      : undefined;

  // Body
  const trimmed = parsed.body.trim();
  const body = trimmed.length > 0 ? trimmed : undefined;

  return {
    name,
    description: fm.description as string | undefined,
    model: fm.model as string | undefined,
    tools,
    skills,
    thinking: fm.thinking as ThinkingLevel | undefined,
    body,
    filePath,
  };
}

// ── Spawn validation helpers ──

export const VALID_THINKING_LEVELS: ReadonlySet<string> =
  new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

/**
 * Find an exact model reference match.
 * Supports bare model ID or canonical `provider/model` reference.
 * Ambiguous bare IDs (multiple providers) return `undefined`.
 *
 * Mirrors `findExactModelReferenceMatch` from pi-coding-agent's
 * model-resolver (not re-exported from the package public API).
 */
export function findModelMatch(
  modelRef: string,
  models: Model<Api>[],
): Model<Api> | undefined {
  const ref = modelRef.trim().toLowerCase();
  if (!ref) return undefined;

  // Try canonical provider/id
  const canonical = models.filter(
    (m) => `${m.provider}/${m.id}`.toLowerCase() === ref,
  );
  if (canonical.length === 1) return canonical[0];
  if (canonical.length > 1) return undefined;

  // Try provider/id with slash split
  const slash = ref.indexOf("/");
  if (slash !== -1) {
    const provider = ref.substring(0, slash).trim();
    const id = ref.substring(slash + 1).trim();
    if (provider && id) {
      const matches = models.filter(
        (m) =>
          m.provider.toLowerCase() === provider && m.id.toLowerCase() === id,
      );
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return undefined;
    }
  }

  // Try bare id
  const idMatches = models.filter((m) => m.id.toLowerCase() === ref);
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

/**
 * Validate an agent definition's model and thinking level for spawning.
 * Throws on validation failure with descriptive error messages.
 */
export function validateAgentForSpawn(
  agentDef: AgentDefinition,
  availableModels: Model<Api>[],
): void {
  // Validate model against available models
  if (agentDef.model) {
    const match = findModelMatch(agentDef.model, availableModels);
    if (!match) {
      throw new Error(
        `Agent "${agentDef.name}": model "${agentDef.model}" not found or ambiguous in available models`,
      );
    }
  }

  // Validate thinking level
  if (agentDef.thinking && !VALID_THINKING_LEVELS.has(agentDef.thinking)) {
    throw new Error(
      `Agent "${agentDef.name}": invalid thinking level "${agentDef.thinking}"`,
    );
  }
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
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

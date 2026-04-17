# Agent definitions

Implements [ADR-0007](../adrs/0007-agent-definitions.md) and [ADR-0008](../adrs/0008-agent-body-appends-system-prompt.md).

## Overview

Agent definitions are named launch configurations that bundle role-specific behavior for envoy runs. `spawn_envoy` accepts an optional `agent` parameter that resolves to a definition file, configuring the child subprocess without requiring the caller to compose CLI flags.

## Definition file format

Agent definitions are markdown files with YAML frontmatter.

```markdown
---
description: Research agent — finds authoritative information from primary sources.
model: claude-sonnet-4-20250514
tools:
  - web_search
  - fetch_content
skills:
  - librarian
thinking: high
---

You are a research agent. Your job is to find authoritative information
from primary sources. Do not write or edit code. Return findings as a
structured summary with source URLs.
```

### Frontmatter fields

All frontmatter fields are optional. Unknown fields are silently ignored.

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Short human-readable description of the agent's role. Surfaced to the LLM so it can select the right agent (see [LLM discovery](#llm-discovery)). |
| `model` | `string` | Model selector for the child subprocess. Accepts a bare model ID (e.g., `claude-sonnet-4`) or a canonical `provider/model` reference (e.g., `anthropic/claude-sonnet-4`). Bare IDs are provider-agnostic — they resolve when exactly one configured provider offers that model, and fail on ambiguity. Validated at spawn time against the parent's model registry. |
| `tools` | `string[]` | Tool names to enable. |
| `skills` | `string[]` | Skill names to enable. |
| `thinking` | `ThinkingLevel` | Thinking level. Validated at spawn time. |

### Body

The markdown body (everything after the frontmatter) contains the agent's role instructions (system-level). The frontmatter is stripped; only the body is used. This is distinct from the `prompt` parameter, which is the task-level user message.

At spawn time:

1. The body is written to `<runDir>/agent-body.md`
2. The file path is passed to the child via `--append-system-prompt <runDir>/agent-body.md`
3. Pi reads the file content (avoids `ARG_MAX` limits for large role instructions)
4. The child's default system prompt is preserved (per ADR-0008)

An empty or whitespace-only body is valid — `--append-system-prompt` is omitted entirely, and the agent uses only pi's default system prompt.

## Discovery and LLM visibility

Agent definitions are discovered from:

```
<agentDir>/agents/
```

where `<agentDir>` defaults to `~/.pi/agent/` (respects `PI_CODING_AGENT_DIR`).

Each `.md` file in this directory defines one agent. The agent name is the filename stem (without `.md` extension).

```
~/.pi/agent/agents/
├── researcher.md
├── reviewer.md
└── implementer.md
```

Files that fail to parse are silently skipped during discovery.

### LLM discovery

At session start, available agents are scanned and injected into `spawn_envoy`'s prompt guidelines. The LLM sees agent names and descriptions without needing a separate listing tool:

```
Available agents for spawn_envoy:
- researcher: Research agent — finds authoritative information from primary sources.
- reviewer: Code reviewer — reads code and provides feedback. Does not edit files.
```

Agents without a `description` are listed by name only. Skills may also reference agents by name per ADR-0007.

### Name constraints

- Must match `/^[a-z][a-z0-9-]*$/` (lowercase alphanumeric with hyphens, starting with a letter).
- No subdirectory nesting — only top-level `.md` files are discovered.

## Spawn flow

When `spawn_envoy` receives an `agent` parameter:

1. Validate the agent name against the naming constraint
2. Resolve `<agentDir>/agents/<agent>.md` — reject if not found (no fallback to a bare run)
3. Parse frontmatter and body — reject on invalid YAML or invalid field types
4. Validate `model` against the parent's model registry — reject if not found or ambiguous
5. Validate `thinking` is a valid `ThinkingLevel` — reject if invalid
6. Allocate run ID, create run directory, write `agent-body.md` (if body present), persist `agent` in `request.json`
7. Start the child subprocess with the configured CLI flags

Validation failure (steps 1–5) rejects the spawn before any run directory or state is created. The child process does not re-validate the model — validation is the parent's responsibility.

Resolution happens at spawn time. Changes to definition files take effect on the next spawn.

## Effect on child subprocess CLI args

The agent definition translates to additional CLI flags on the child `pi` subprocess.

| Definition field | CLI flag(s) |
|-----------------|-------------|
| `model` | `--model <value>` |
| `tools` | `--tools <name>,<name>,...` (comma-separated) |
| `skills` | `--skill <name>` for each entry |
| `thinking` | `--thinking <value>` |
| body | `--append-system-prompt <runDir>/agent-body.md` (file path; pi reads it) |

Agent definition flags are appended before the `@<runDir>/prompt.md` file argument, which must remain last.

## API changes

`spawn_envoy` gains an optional `agent` parameter (string). When omitted, behavior is unchanged. When provided, the definition is resolved and applied to the child subprocess.

### Type changes

`SpawnEnvoyInput` gains:

```typescript
agent?: string;
```

`RequestFile` gains:

```typescript
agent?: string;
```

The `agent` name is persisted in `request.json` for traceability.

### New types

```typescript
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

/** Parsed agent definition */
interface AgentDefinition {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  thinking?: ThinkingLevel;
  body?: string;
  filePath: string;
}
```

## Error cases

| Condition | Behavior |
|-----------|----------|
| `agent` name doesn't match naming constraint | Throw before spawn |
| Definition file not found | Throw before spawn |
| Frontmatter has invalid types for known fields | Throw before spawn |
| Frontmatter YAML is syntactically invalid | Throw before spawn |
| `tools` or `skills` not available | Not validated at spawn time — child process fails naturally |
| `model` not in available models | Throw before spawn |
| `model` bare ID is ambiguous (multiple providers) | Throw before spawn — use `provider/model` to disambiguate |
| `thinking` not a valid level | Throw before spawn |

## Non-goals

- Runtime validation of tool/skill availability (child process handles this)
- Programmatic agent definition creation (file-based only)
- Agent inheritance or composition
- Dynamic agent selection by the child
- Agent definition hot-reloading within a running session
- Provider priority or heuristic selection for ambiguous bare model IDs (future consideration)
- Project-scoped agent definitions (future consideration)

# ADR 0007: Named agent definitions for envoy launch

- Status: Accepted
- Date: 2026-04-16

## Context

Envoys launch with a prompt. Supporting different roles (researcher, implementer, reviewer) requires configuring the child's system prompt, model, tools, skills, extensions, and thinking level.

Four approaches were considered:

1. **Raw CLI pass-through** (`piArgs?: string[]`). The calling LLM must compose flags correctly — brittle and unreliable. Skills would need to embed exact CLI invocations in their instructions.

2. **Structured config fields** (`systemPrompt`, `tools`, `skills`, etc. as individual parameters on `spawn_envoy`). Better than raw args, but still requires the LLM to set multiple fields correctly per role. Role definitions end up scattered across skill prose.

3. **Separate package** registers role-specific tools (`spawn_researcher`, `spawn_reviewer`). Clean LLM UX, but the LLM sees competing tool sets — `spawn_envoy` from pi-envoys and `spawn_researcher` from the roles package — with no reason to prefer one over the other.

4. **Named agent definitions** — `spawn_envoy` accepts a name that resolves to a static configuration file. The LLM references a role by name; pi-envoys resolves it. No flag composition, no competing tools, no scattered config.

## Decision

`spawn_envoy` gains an optional `agent` parameter. Agent definitions are named launch configurations — static files that bundle agent instructions, model, tools, skills, extensions, and thinking level. The caller references a definition by name; pi-envoys resolves and applies it.

```
spawn_envoy(
  prompt: string,
  agent?: string,
)
```

When `agent` is omitted, behavior is unchanged — a bare pi subprocess with default system prompt and tools.

Skills reference agents by name ("spawn a researcher") and the LLM calls `spawn_envoy(agent="researcher", prompt="...")`. No flag composition, no competing tools.

See ADR-0002 clarification for how this relates to explicit context.

## Consequences

- Skills can reference roles by name without the LLM composing raw CLI flags
- `spawn_envoy` remains the single tool for launching envoys
- pi-envoys owns agent definition files — format and discovery specified separately
- Agent definitions are static launch configurations, not orchestration policy — tiering, review gates, and workflow logic remain in skills

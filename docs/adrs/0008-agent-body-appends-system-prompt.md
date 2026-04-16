# ADR 0008: Agent body appends to system prompt

- Status: Accepted
- Date: 2026-04-16

## Context

An agent definition's markdown body configures the child's behavior. It could either replace pi's default system prompt entirely or append to it. Pi provides both mechanisms: `--system-prompt` (replace) and `--append-system-prompt` (append). See pi's documentation for the exact semantics of each flag.

## Decision

The agent body is passed to the child via `--append-system-prompt` (ADR-0007 introduces agent definitions).

Agent definitions describe roles — a code reviewer, a researcher, an implementer. These roles are additive constraints on top of a capable base agent: "you are a reviewer, do not edit files" works layered on pi's defaults. Replacing the default system prompt would require agent authors to replicate tool usage conventions and other base instructions that the child needs regardless of role.

## Consequences

- Agent definitions stay focused on role-specific behavior, not boilerplate
- Pi's default system prompt behavior (tool guidance, extension contributions) is preserved — see pi's `--append-system-prompt` documentation for details
- Agent authors don't need to track changes to pi's default prompt

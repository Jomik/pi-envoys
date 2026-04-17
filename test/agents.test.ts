import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockAgentDir: string;

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => mockAgentDir,
  };
});

import {
  AGENT_NAME_RE,
  discoverAgents,
  loadAgentDefinition,
} from "../src/agents.js";

// ── Helpers ──

let tmpRoot: string;

function writeAgent(name: string, content: string): void {
  const agentsDir = join(mockAgentDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${name}.md`), content);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pi-envoys-agents-test-"));
  mockAgentDir = tmpRoot;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── AGENT_NAME_RE ──

describe("AGENT_NAME_RE", () => {
  it.each([
    "researcher",
    "code-reviewer",
    "a1",
    "a-b-c",
  ])("matches valid name: %s", (name) => {
    expect(AGENT_NAME_RE.test(name)).toBe(true);
  });

  it.each([
    "Researcher",
    "123",
    "-bad",
    "has space",
    "has_underscore",
    "",
  ])("rejects invalid name: %j", (name) => {
    expect(AGENT_NAME_RE.test(name)).toBe(false);
  });
});

// ── loadAgentDefinition ──

describe("loadAgentDefinition", () => {
  it("loads full definition with all fields", () => {
    writeAgent(
      "research",
      `---
description: Research agent
model: claude-sonnet-4-20250514
tools:
  - web_search
  - fetch_content
skills:
  - librarian
thinking: high
---

You are a research agent.
`,
    );

    const def = loadAgentDefinition("research");
    expect(def.name).toBe("research");
    expect(def.description).toBe("Research agent");
    expect(def.model).toBe("claude-sonnet-4-20250514");
    expect(def.tools).toEqual(["web_search", "fetch_content"]);
    expect(def.skills).toEqual(["librarian"]);
    expect(def.thinking).toBe("high");
    expect(def.body).toBe("You are a research agent.");
    expect(def.filePath).toBe(join(mockAgentDir, "agents", "research.md"));
  });

  it("loads minimal definition (empty frontmatter, just body)", () => {
    writeAgent("minimal", "---\n---\nJust a body.");

    const def = loadAgentDefinition("minimal");
    expect(def.name).toBe("minimal");
    expect(def.description).toBeUndefined();
    expect(def.model).toBeUndefined();
    expect(def.tools).toBeUndefined();
    expect(def.skills).toBeUndefined();
    expect(def.thinking).toBeUndefined();
    expect(def.body).toBe("Just a body.");
  });

  it("loads definition with no body (empty body → body is undefined)", () => {
    writeAgent("nobody", "---\ndescription: No body\n---\n");

    const def = loadAgentDefinition("nobody");
    expect(def.description).toBe("No body");
    expect(def.body).toBeUndefined();
  });

  it("loads definition with only frontmatter, no body → body is undefined", () => {
    writeAgent("fmonly", "---\ndescription: FM only\n---");

    const def = loadAgentDefinition("fmonly");
    expect(def.description).toBe("FM only");
    expect(def.body).toBeUndefined();
  });

  it("body that is only whitespace → body is undefined", () => {
    writeAgent("whitespace", "---\ndescription: ws\n---\n   \n  \n");

    const def = loadAgentDefinition("whitespace");
    expect(def.body).toBeUndefined();
  });

  it("throws on invalid name (uppercase)", () => {
    expect(() => loadAgentDefinition("Researcher")).toThrow(
      /Invalid agent name/,
    );
  });

  it("throws on invalid name (starts with number)", () => {
    expect(() => loadAgentDefinition("123agent")).toThrow(/Invalid agent name/);
  });

  it("throws on missing file", () => {
    expect(() => loadAgentDefinition("nonexistent")).toThrow(
      /Agent definition not found/,
    );
  });

  it("throws when description is not a string", () => {
    writeAgent("bad-desc", "---\ndescription: 42\n---\n");
    // YAML parses bare `42` as a number
    expect(() => loadAgentDefinition("bad-desc")).toThrow(
      /field "description" must be a string/,
    );
  });

  it("throws when model is not a string", () => {
    writeAgent("bad-model", "---\nmodel: 123\n---\n");
    expect(() => loadAgentDefinition("bad-model")).toThrow(
      /field "model" must be a string/,
    );
  });

  it("throws when thinking is not a string", () => {
    writeAgent("bad-think", "---\nthinking: 42\n---\n");
    expect(() => loadAgentDefinition("bad-think")).toThrow(
      /field "thinking" must be a string/,
    );
  });

  it("throws when tools is not a string array", () => {
    writeAgent("bad-tools", "---\ntools: 123\n---\n");
    expect(() => loadAgentDefinition("bad-tools")).toThrow(
      /field "tools" must be a string\[\]/,
    );
  });

  it("throws when tools contains non-strings", () => {
    writeAgent("bad-tools2", "---\ntools:\n  - 123\n  - 456\n---\n");
    expect(() => loadAgentDefinition("bad-tools2")).toThrow(
      /field "tools" must be a string\[\]/,
    );
  });

  it("throws when skills is not a string array", () => {
    writeAgent("bad-skills", "---\nskills: true\n---\n");
    expect(() => loadAgentDefinition("bad-skills")).toThrow(
      /field "skills" must be a string\[\]/,
    );
  });

  it("loads plain markdown without frontmatter delimiters", () => {
    writeAgent("plain", "Just some instructions.");
    const def = loadAgentDefinition("plain");
    expect(def.name).toBe("plain");
    expect(def.body).toBe("Just some instructions.");
    expect(def.description).toBeUndefined();
    expect(def.model).toBeUndefined();
  });

  it("ignores unknown frontmatter fields", () => {
    writeAgent(
      "extra",
      "---\nunknown_field: foo\ntimeout: 30\ndescription: Valid\n---\nBody.",
    );
    const def = loadAgentDefinition("extra");
    expect(def.description).toBe("Valid");
    expect(def.body).toBe("Body.");
    // Unknown fields should not appear on the result
    expect(
      (def as unknown as Record<string, unknown>).unknown_field,
    ).toBeUndefined();
    expect((def as unknown as Record<string, unknown>).timeout).toBeUndefined();
  });
});

// ── discoverAgents ──

describe("discoverAgents", () => {
  it("returns empty array when agents directory doesn't exist", () => {
    // Don't create agents/ dir
    const agents = discoverAgents();
    expect(agents).toEqual([]);
  });

  it("discovers multiple agents", () => {
    writeAgent("alpha", "---\ndescription: Alpha\n---\nAlpha body.");
    writeAgent("beta", "---\ndescription: Beta\n---\nBeta body.");

    const agents = discoverAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(agents.find((a) => a.name === "alpha")?.description).toBe("Alpha");
    expect(agents.find((a) => a.name === "beta")?.body).toBe("Beta body.");
  });

  it("silently skips files that fail to parse", () => {
    writeAgent("good", "---\ndescription: Good\n---\nGood.");
    writeAgent("bad", "---\n[invalid yaml\n---\n");

    const agents = discoverAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("good");
  });

  it("skips non-.md files", () => {
    writeAgent("valid", "---\ndescription: Valid\n---\nBody.");
    // Write a .txt file
    const agentsDir = join(mockAgentDir, "agents");
    writeFileSync(join(agentsDir, "notes.txt"), "not an agent");

    const agents = discoverAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("valid");
  });

  it("skips directories inside agents/", () => {
    writeAgent("valid", "---\ndescription: Valid\n---\nBody.");
    const agentsDir = join(mockAgentDir, "agents");
    mkdirSync(join(agentsDir, "subdir.md"), { recursive: true });

    const agents = discoverAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("valid");
  });

  it("skips files with invalid agent names", () => {
    writeAgent("valid", "---\ndescription: Valid\n---\nBody.");
    // Create a file with uppercase name (invalid per AGENT_NAME_RE)
    const agentsDir = join(mockAgentDir, "agents");
    writeFileSync(
      join(agentsDir, "Bad-Name.md"),
      "---\ndescription: Bad\n---\nBody.",
    );

    const agents = discoverAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("valid");
  });
});

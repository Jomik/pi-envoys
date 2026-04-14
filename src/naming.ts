import { randomBytes } from "node:crypto";

// ── runId ──

/**
 * Allocate an opaque, filesystem-safe run identifier.
 *
 * Format: 12 hex chars from crypto randomBytes (48 bits of entropy).
 * Collision probability is negligible for local run stores.
 */
export function allocateRunId(): string {
  return randomBytes(6).toString("hex");
}

// ── Display names ──

const ADJECTIVES = [
  "bold",
  "calm",
  "dark",
  "dry",
  "fair",
  "fast",
  "flat",
  "free",
  "glad",
  "gold",
  "gray",
  "keen",
  "kind",
  "lean",
  "long",
  "lost",
  "loud",
  "neat",
  "pale",
  "pure",
  "rare",
  "real",
  "rich",
  "safe",
  "slim",
  "soft",
  "sure",
  "tall",
  "warm",
  "wide",
  "wild",
  "wise",
] as const;

const NOUNS = [
  "arc",
  "bay",
  "cape",
  "cove",
  "dale",
  "dawn",
  "dew",
  "dune",
  "echo",
  "edge",
  "elm",
  "fern",
  "flint",
  "fox",
  "gate",
  "glen",
  "gust",
  "hawk",
  "hill",
  "jade",
  "lake",
  "lark",
  "leaf",
  "lynx",
  "mesa",
  "mist",
  "moon",
  "oak",
  "peak",
  "pine",
  "reef",
  "sage",
] as const;

/**
 * Generate a human-readable display name.
 *
 * Format: `<adjective>-<noun>` — e.g. `bold-hawk`.
 * Not guaranteed unique; `runId` is the canonical identifier.
 */
export function generateName(): string {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  return `${adj}-${noun}`;
}

function randomInt(max: number): number {
  // Use crypto for uniform distribution
  const buf = randomBytes(4);
  return buf.readUInt32BE(0) % max;
}

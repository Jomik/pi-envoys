/**
 * Extract spawned envoy runIds from session branch entries.
 *
 * Walks entries produced by `sessionManager.getBranch()` and collects
 * runIds from `envoy_spawn` custom entries. Deduplicates and preserves order.
 */
export function extractSpawnedRunIds(
  entries: readonly { type: string }[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (!("customType" in entry) || entry.customType !== "envoy_spawn") continue;
    if (!("data" in entry) || entry.data == null || typeof entry.data !== "object") continue;
    if (!("runId" in entry.data) || typeof entry.data.runId !== "string") continue;
    const { runId } = entry.data;
    if (!seen.has(runId)) {
      seen.add(runId);
      ids.push(runId);
    }
  }

  return ids;
}

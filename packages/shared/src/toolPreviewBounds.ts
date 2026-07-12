import type { ToolFileChangePreview } from "@t3tools/contracts";

export const TOOL_PREVIEW_TRUNCATION_MARKER = "\n… preview truncated …\n";
const TOOL_PREVIEW_JSON_MAX_DEPTH = 64;

function safeSlice(value: string, start: number, end?: number): string {
  let safeStart = start;
  let safeEnd = end ?? value.length;
  if (safeStart > 0 && safeStart < value.length && /[\uDC00-\uDFFF]/u.test(value[safeStart]!)) {
    safeStart += 1;
  }
  if (safeEnd > 0 && safeEnd < value.length && /[\uD800-\uDBFF]/u.test(value[safeEnd - 1]!)) {
    safeEnd -= 1;
  }
  return value.slice(safeStart, safeEnd);
}

export function truncateToolPreviewText(
  value: string,
  limit: number,
  headWeight = 0.5,
): { readonly value: string; readonly truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  const available = Math.max(0, limit - TOOL_PREVIEW_TRUNCATION_MARKER.length);
  const headLength = Math.floor(available * headWeight);
  const tailLength = available - headLength;
  return {
    value: `${safeSlice(value, 0, headLength)}${TOOL_PREVIEW_TRUNCATION_MARKER}${safeSlice(value, value.length - tailLength)}`,
    truncated: true,
  };
}

function stableJsonValue(value: unknown, ancestors: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (typeof value !== "object") return value;
  if (depth >= TOOL_PREVIEW_JSON_MAX_DEPTH) return "[Depth limit]";
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => stableJsonValue(entry, ancestors, depth + 1))
    : Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [
            key,
            stableJsonValue((value as Record<string, unknown>)[key], ancestors, depth + 1),
          ]),
      );
  ancestors.delete(value);
  return normalized;
}

export function stableBoundedJson(value: unknown, limit: number) {
  try {
    const serialized = JSON.stringify(stableJsonValue(value, new WeakSet(), 0));
    if (serialized !== undefined) return truncateToolPreviewText(serialized, limit);
  } catch {
    // Fall through to a string preview for hostile getters/proxies.
  }
  try {
    return truncateToolPreviewText(String(value), limit);
  } catch {
    return { value: "[Unserializable]", truncated: false };
  }
}

export function boundToolPreviewFiles(
  files: ReadonlyArray<ToolFileChangePreview>,
  limit = 50,
): { readonly files: ReadonlyArray<ToolFileChangePreview>; readonly truncated: boolean } {
  const deduplicated = [
    ...new Map(files.map((file) => [`${file.sourcePath ?? ""}\0${file.path}`, file])).values(),
  ];
  if (deduplicated.length <= limit) return { files: deduplicated, truncated: false };
  const headLength = Math.floor(limit / 2);
  return {
    files: [...deduplicated.slice(0, headLength), ...deduplicated.slice(-(limit - headLength))],
    truncated: true,
  };
}

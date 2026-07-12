import { describe, expect, it } from "vite-plus/test";

import {
  boundToolPreviewFiles,
  stableBoundedJson,
  truncateToolPreviewText,
} from "./toolPreviewBounds.ts";

describe("toolPreviewBounds", () => {
  it("truncates previews without splitting surrogate pairs", () => {
    const result = truncateToolPreviewText(`head😀${"x".repeat(50)}😀tail`, 32, 3 / 8);
    expect(result.truncated).toBe(true);
    expect(result.value).toHaveLength(32);
    expect(Array.from(result.value).join("")).toBe(result.value);
  });

  it("serializes generic input deterministically and handles cycles", () => {
    const circular: Record<string, unknown> = { z: 1, a: 2 };
    circular.self = circular;
    expect(stableBoundedJson(circular, 1_000)).toEqual({
      value: '{"a":2,"self":"[Circular]","z":1}',
      truncated: false,
    });
  });

  it("does not label shared non-circular references as circular", () => {
    const shared = { value: 1 };
    expect(stableBoundedJson({ first: shared, second: shared }, 1_000)).toEqual({
      value: '{"first":{"value":1},"second":{"value":1}}',
      truncated: false,
    });
  });

  it("bounds deeply nested and hostile values without throwing", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 100; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    expect(stableBoundedJson(root, 10_000).value).toContain("[Depth limit]");

    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("blocked");
        },
        get() {
          throw new Error("blocked");
        },
      },
    );
    expect(() => stableBoundedJson(hostile, 100)).not.toThrow();
  });

  it("keeps first and last bounded unique file metadata", () => {
    const result = boundToolPreviewFiles(
      Array.from({ length: 52 }, (_, index) => ({
        path: `file-${index}.ts`,
        changeKind: "update" as const,
      })),
    );
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(50);
    expect(result.files[0]?.path).toBe("file-0.ts");
    expect(result.files.at(-1)?.path).toBe("file-51.ts");
  });
});

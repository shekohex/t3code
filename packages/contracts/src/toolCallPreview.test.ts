import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  TOOL_CALL_ID_MAX_LENGTH,
  TOOL_NAME_MAX_LENGTH,
  TOOL_PREVIEW_DIFF_MAX_LENGTH,
  TOOL_PREVIEW_FILES_MAX_LENGTH,
  TOOL_PREVIEW_OUTPUT_MAX_LENGTH,
  TOOL_PREVIEW_PATH_MAX_LENGTH,
  ToolCallId,
  ToolCallPreview,
  ToolName,
} from "./toolCallPreview.ts";

const decodePreview = Schema.decodeUnknownSync(ToolCallPreview);
const decodeToolName = Schema.decodeUnknownSync(ToolName);
const decodeToolCallId = Schema.decodeUnknownSync(ToolCallId);

describe("ToolCallPreview", () => {
  it("accepts values at contract bounds", () => {
    expect(
      decodePreview({
        kind: "command",
        command: "x",
        output: "x".repeat(TOOL_PREVIEW_OUTPUT_MAX_LENGTH),
      }).kind,
    ).toBe("command");
    expect(
      decodePreview({
        kind: "file_change",
        files: [],
        unifiedDiff: "x".repeat(TOOL_PREVIEW_DIFF_MAX_LENGTH),
      }).kind,
    ).toBe("file_change");
  });

  it("rejects malformed and over-limit values", () => {
    expect(() => decodePreview({ kind: "unknown" })).toThrow();
    expect(() =>
      decodePreview({ kind: "read", path: "x".repeat(TOOL_PREVIEW_PATH_MAX_LENGTH + 1) }),
    ).toThrow();
    expect(() =>
      decodePreview({
        kind: "file_change",
        files: Array.from({ length: TOOL_PREVIEW_FILES_MAX_LENGTH + 1 }, () => ({
          path: "x",
          changeKind: "update",
        })),
      }),
    ).toThrow();
    expect(() =>
      decodePreview({
        kind: "file_change",
        files: [{ path: "x", changeKind: "update", additions: -1 }],
      }),
    ).toThrow();
  });

  it("bounds canonical identity", () => {
    expect(decodeToolName("x".repeat(TOOL_NAME_MAX_LENGTH))).toHaveLength(TOOL_NAME_MAX_LENGTH);
    expect(() => decodeToolName("x".repeat(TOOL_NAME_MAX_LENGTH + 1))).toThrow();
    expect(decodeToolCallId("x".repeat(TOOL_CALL_ID_MAX_LENGTH))).toHaveLength(
      TOOL_CALL_ID_MAX_LENGTH,
    );
    expect(() => decodeToolCallId("x".repeat(TOOL_CALL_ID_MAX_LENGTH + 1))).toThrow();
  });
});

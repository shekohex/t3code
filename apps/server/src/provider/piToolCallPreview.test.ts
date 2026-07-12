import { describe, expect, it } from "vite-plus/test";

import { canonicalPiToolCallId, projectPiToolCall } from "./piToolCallPreview.ts";

describe("projectPiToolCall", () => {
  it("maps command and read previews", () => {
    expect(
      projectPiToolCall({
        toolName: "bash",
        args: { command: "printf hi" },
        result: { content: [{ type: "text", text: "hi\nCommand exited with code 2" }] },
      }),
    ).toMatchObject({
      itemType: "command_execution",
      title: "Ran command",
      toolPreview: { kind: "command", command: "printf hi", exitCode: 2 },
    });
    expect(
      projectPiToolCall({
        toolName: "read",
        args: { path: "src/a.ts", offset: 2, limit: 4 },
        result: { content: [{ type: "text", text: "body" }] },
      }).toolPreview,
    ).toEqual({
      kind: "read",
      path: "src/a.ts",
      offset: 2,
      limit: 4,
      content: "body",
    });
  });

  it("prefers native patch and wrapper aggregate diff without raw file copies", () => {
    const native = projectPiToolCall({
      toolName: "edit",
      args: { path: "a.ts" },
      result: { details: { diff: "display", patch: "native patch" } },
    });
    expect(native.toolPreview).toMatchObject({ kind: "file_change", unifiedDiff: "native patch" });
    const wrapper = projectPiToolCall({
      toolName: "apply_patch",
      args: {},
      result: {
        content: [{ type: "text", text: "updated" }],
        details: {
          diff: "aggregate",
          files: [
            {
              relativePath: "a.ts",
              type: "update",
              before: "FULL_OLD_FILE_SENTINEL",
              after: "FULL_NEW_FILE_SENTINEL",
              diff: "copy",
              additions: 1,
              deletions: 1,
            },
          ],
          totalFiles: 1,
          completedFiles: 1,
        },
      },
    });
    expect(wrapper.toolPreview).toMatchObject({
      kind: "file_change",
      unifiedDiff: "aggregate",
      files: [{ path: "a.ts", changeKind: "update", additions: 1, deletions: 1 }],
    });
    expect(JSON.stringify(wrapper)).not.toContain("FULL_OLD_FILE_SENTINEL");
    expect(JSON.stringify(wrapper)).not.toContain("FULL_NEW_FILE_SENTINEL");
  });

  it("omits incomplete oversized diffs and bounds files", () => {
    const projection = projectPiToolCall({
      toolName: "apply_patch",
      args: {},
      result: {
        details: {
          diff: "x".repeat(64_001),
          files: Array.from({ length: 100 }, (_, index) => ({
            relativePath: `${index}.ts`,
            type: "update",
          })),
        },
      },
    });
    expect(projection.toolPreview).toMatchObject({
      kind: "file_change",
      diffTruncated: true,
      filesTruncated: true,
    });
    if (projection.toolPreview.kind === "file_change") {
      expect(projection.toolPreview.unifiedDiff).toBeUndefined();
      expect(projection.toolPreview.files).toHaveLength(50);
      expect(projection.toolPreview.files[0]?.path).toBe("0.ts");
      expect(projection.toolPreview.files.at(-1)?.path).toBe("99.ts");
    }
  });

  it("preserves source and target paths for moved files", () => {
    const projection = projectPiToolCall({
      toolName: "apply_patch",
      args: {},
      result: {
        details: {
          diff: "move patch",
          files: [
            {
              relativePath: "src/new.ts",
              sourceRelativePath: "src/old.ts",
              type: "move",
            },
          ],
        },
      },
    });

    expect(projection.toolPreview).toMatchObject({
      kind: "file_change",
      files: [
        {
          path: "src/new.ts",
          sourcePath: "src/old.ts",
          changeKind: "move",
        },
      ],
    });
  });

  it("uses stable bounded generic previews and ids", () => {
    const projection = projectPiToolCall({
      toolName: "custom",
      args: { z: 1, a: 2 },
      result: { ok: true },
    });
    expect(projection.toolPreview).toEqual({
      kind: "generic",
      toolName: "custom",
      input: '{"a":2,"z":1}',
      output: '{"ok":true}',
    });
    expect(canonicalPiToolCallId("x".repeat(513))).toMatch(/^tool:[a-f0-9]{64}$/u);
    expect(canonicalPiToolCallId("x".repeat(513))).toBe(canonicalPiToolCallId("x".repeat(513)));
  });

  it("keeps unknown names generic and supports string content results", () => {
    expect(
      projectPiToolCall({
        toolName: "create_issue",
        args: { title: "Bug" },
        result: { content: "created" },
      }),
    ).toMatchObject({
      itemType: "dynamic_tool_call",
      title: "create_issue",
      toolPreview: {
        kind: "generic",
        toolName: "create_issue",
        output: "created",
      },
    });
    expect(
      projectPiToolCall({
        toolName: "exec",
        args: { script: "echo hi" },
        result: { content: "hi" },
      }).toolPreview,
    ).toMatchObject({ kind: "generic", toolName: "exec" });
  });

  it("keeps local searches distinct from web searches", () => {
    expect(
      projectPiToolCall({
        toolName: "rg",
        args: { pattern: "ToolCallPreview", path: "apps" },
        result: { content: "apps/web/src/session-logic.ts" },
      }),
    ).toMatchObject({
      itemType: "dynamic_tool_call",
      title: "Searched files",
      toolPreview: { kind: "search", query: "ToolCallPreview", path: "apps" },
    });
  });

  it("preserves specialized lifecycle types for explicit provider tools", () => {
    expect(projectPiToolCall({ toolName: "web_search", args: {} })).toMatchObject({
      itemType: "web_search",
      toolPreview: { kind: "generic", toolName: "web_search" },
    });
    expect(projectPiToolCall({ toolName: "mcp_server_tool", args: {} })).toMatchObject({
      itemType: "mcp_tool_call",
      toolPreview: { kind: "generic", toolName: "mcp_server_tool" },
    });
    expect(projectPiToolCall({ toolName: "subagent", args: {} })).toMatchObject({
      itemType: "collab_agent_tool_call",
      toolPreview: { kind: "generic", toolName: "subagent" },
    });
  });
});

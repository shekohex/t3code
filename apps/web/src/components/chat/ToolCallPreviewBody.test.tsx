import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { fileDiff: { name?: string | null; prevName?: string | null } }) => (
    <div data-testid="file-diff">{props.fileDiff.name ?? props.fileDiff.prevName}</div>
  ),
}));

import { ToolCallPreviewBody } from "./ToolCallPreviewBody";

const baseProps = {
  previewId: "preview-1",
  turnId: null,
  canOpenTurnDiff: false,
  workspaceRoot: undefined,
  resolvedTheme: "light" as const,
  onOpenTurnDiff: () => {},
};

describe("ToolCallPreviewBody", () => {
  it("renders command output as escaped plain text", () => {
    const html = renderToStaticMarkup(
      <ToolCallPreviewBody
        {...baseProps}
        preview={{
          kind: "command",
          command: "printf '<script>'",
          output: "<script>alert('x')</script>",
        }}
      />,
    );

    expect(html).toContain("printf &#x27;&lt;script&gt;&#x27;");
    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders read path, range, and truncation notice", () => {
    const html = renderToStaticMarkup(
      <ToolCallPreviewBody
        {...baseProps}
        preview={{
          kind: "read",
          path: "src/value.ts",
          offset: 10,
          limit: 20,
          content: "export const value = 1;\n",
          contentTruncated: true,
        }}
      />,
    );

    expect(html).toContain("src/value.ts (offset 10, limit 20)");
    expect(html).toContain("export const value = 1;");
    expect(html).toContain("Content preview truncated");
  });

  it("parses complete unified patches into file diff components", () => {
    const html = renderToStaticMarkup(
      <ToolCallPreviewBody
        {...baseProps}
        preview={{
          kind: "file_change",
          files: [{ path: "src/value.ts", changeKind: "update", additions: 1, deletions: 1 }],
          unifiedDiff:
            "diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-old\n+new\n",
        }}
      />,
    );

    expect(html).toContain('data-testid="file-diff"');
    expect(html).toContain("src/value.ts");
    expect(html).not.toContain("FULL_OLD_FILE_SENTINEL");
  });

  it("shows omitted diff state without opening an unavailable checkpoint", () => {
    const html = renderToStaticMarkup(
      <ToolCallPreviewBody
        {...baseProps}
        preview={{
          kind: "file_change",
          files: [{ path: "src/value.ts", changeKind: "update" }],
          diffTruncated: true,
        }}
      />,
    );

    expect(html).toContain("File-change preview truncated");
    expect(html).toContain("Full turn diff not ready");
    expect(html).not.toContain("View full turn diff");
  });
});

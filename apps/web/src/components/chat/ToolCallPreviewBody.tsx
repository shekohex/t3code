import type { ToolCallPreview, TurnId } from "@t3tools/contracts";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";

import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { Button } from "../ui/button";

interface ToolCallPreviewBodyProps {
  previewId: string;
  preview: ToolCallPreview;
  turnId: TurnId | null;
  canOpenTurnDiff: boolean;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}

function PreviewTextBlock(props: { label: string; text: string }) {
  return (
    <section className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/55">
        {props.label}
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
        {props.text}
      </pre>
    </section>
  );
}

function TruncationNotice({ children }: { children: string }) {
  return <p className="text-[11px] text-warning">{children}</p>;
}

export function ToolCallPreviewBody(props: ToolCallPreviewBodyProps) {
  const { preview } = props;
  const renderablePatch = useMemo(
    () =>
      preview.kind === "file_change"
        ? getRenderablePatch(preview.unifiedDiff, `tool-preview:${props.previewId}`)
        : null,
    [preview, props.previewId],
  );

  if (preview.kind === "command") {
    return (
      <div className="space-y-2">
        <PreviewTextBlock label="Command" text={preview.command} />
        {preview.output ? <PreviewTextBlock label="Output" text={preview.output} /> : null}
        {preview.commandTruncated || preview.outputTruncated ? (
          <TruncationNotice>Preview truncated</TruncationNotice>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "read") {
    const range = [
      preview.offset === undefined ? null : `offset ${preview.offset}`,
      preview.limit === undefined ? null : `limit ${preview.limit}`,
    ]
      .filter((part): part is string => part !== null)
      .join(", ");
    return (
      <div className="space-y-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {formatWorkspaceRelativePath(preview.path, props.workspaceRoot)}
          {range ? ` (${range})` : ""}
        </p>
        {preview.content ? <PreviewTextBlock label="Content" text={preview.content} /> : null}
        {preview.contentTruncated ? (
          <TruncationNotice>Content preview truncated</TruncationNotice>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "search") {
    return (
      <div className="space-y-2">
        {preview.query ? <PreviewTextBlock label="Query" text={preview.query} /> : null}
        {preview.path ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            {formatWorkspaceRelativePath(preview.path, props.workspaceRoot)}
          </p>
        ) : null}
        {preview.output ? <PreviewTextBlock label="Results" text={preview.output} /> : null}
        {preview.queryTruncated || preview.outputTruncated ? (
          <TruncationNotice>Preview truncated</TruncationNotice>
        ) : null}
      </div>
    );
  }

  if (preview.kind === "generic") {
    return (
      <div className="space-y-2">
        {preview.input ? <PreviewTextBlock label="Input" text={preview.input} /> : null}
        {preview.output ? <PreviewTextBlock label="Output" text={preview.output} /> : null}
        {preview.inputTruncated || preview.outputTruncated ? (
          <TruncationNotice>Preview truncated</TruncationNotice>
        ) : null}
      </div>
    );
  }

  const firstPath = preview.files[0]?.path;
  return (
    <div className="space-y-2">
      {preview.files.length > 0 ? (
        <section className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/55">
            Files
          </p>
          <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {preview.files.map((file) => (
              <div key={`${file.sourcePath ?? ""}:${file.path}`} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {file.sourcePath
                    ? `${formatWorkspaceRelativePath(file.sourcePath, props.workspaceRoot)} → ${formatWorkspaceRelativePath(file.path, props.workspaceRoot)}`
                    : formatWorkspaceRelativePath(file.path, props.workspaceRoot)}
                </span>
                {file.additions !== undefined || file.deletions !== undefined ? (
                  <span className="shrink-0 tabular-nums">
                    <span className="text-success">+{file.additions ?? 0}</span>{" "}
                    <span className="text-destructive">-{file.deletions ?? 0}</span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {preview.output ? <PreviewTextBlock label="Result" text={preview.output} /> : null}
      {renderablePatch?.kind === "files" ? (
        <div className="max-h-[30rem] space-y-2 overflow-auto rounded-md border border-border/50">
          {renderablePatch.files.map((fileDiff) => (
            <FileDiff
              key={fileDiff.cacheKey ?? resolveFileDiffPath(fileDiff)}
              fileDiff={fileDiff}
              options={{
                collapsed: renderablePatch.files.length > 1,
                diffStyle: "unified",
                theme: resolveDiffThemeName(props.resolvedTheme),
              }}
            />
          ))}
        </div>
      ) : null}
      {renderablePatch?.kind === "raw" ? (
        <div className="space-y-1">
          <p className="text-[11px] text-warning">{renderablePatch.reason}</p>
          <PreviewTextBlock label="Patch" text={renderablePatch.text} />
        </div>
      ) : null}
      {preview.diffTruncated || preview.filesTruncated || preview.outputTruncated ? (
        <TruncationNotice>File-change preview truncated</TruncationNotice>
      ) : null}
      {props.canOpenTurnDiff && props.turnId ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => props.onOpenTurnDiff(props.turnId!, firstPath)}
        >
          View full turn diff
        </Button>
      ) : preview.diffTruncated ? (
        <p className="text-[11px] text-muted-foreground">Full turn diff not ready</p>
      ) : null}
    </div>
  );
}

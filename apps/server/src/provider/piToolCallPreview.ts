// @effect-diagnostics nodeBuiltinImport:off - Stable provider identity requires SHA-256.
import * as NodeCrypto from "node:crypto";

import type {
  ToolCallPreview,
  ToolFileChangeKind,
  ToolFileChangePreview,
  ToolLifecycleItemType,
} from "@t3tools/contracts";
import {
  TOOL_CALL_ID_MAX_LENGTH,
  TOOL_NAME_MAX_LENGTH,
  TOOL_PREVIEW_DIFF_MAX_LENGTH,
  TOOL_PREVIEW_INPUT_MAX_LENGTH,
  TOOL_PREVIEW_OUTPUT_MAX_LENGTH,
  TOOL_PREVIEW_PATH_MAX_LENGTH,
} from "@t3tools/contracts";
import { deriveToolPreviewPresentation } from "@t3tools/shared/toolActivity";
import {
  boundToolPreviewFiles,
  stableBoundedJson,
  truncateToolPreviewText,
} from "@t3tools/shared/toolPreviewBounds";

interface PiToolCallPreviewInput {
  readonly toolName: string | undefined;
  readonly args: Record<string, unknown> | undefined;
  readonly result?: unknown;
}

export interface PiToolCallProjection {
  readonly itemType: ToolLifecycleItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly toolPreview: ToolCallPreview;
}

const COMMAND_TOOL_NAMES = new Set(["bash", "shell", "command", "exec", "terminal"]);
const READ_TOOL_NAMES = new Set(["read", "read_file", "readfile"]);
const FILE_CHANGE_TOOL_NAMES = new Set([
  "edit",
  "apply_patch",
  "write",
  "create",
  "delete",
  "remove",
  "move",
  "rename",
]);
const SEARCH_TOOL_NAMES = new Set(["grep", "find", "search", "ripgrep", "rg"]);
const WEB_SEARCH_TOOL_NAMES = new Set(["web_search", "websearch", "web_fetch", "webfetch"]);
const IMAGE_TOOL_NAMES = new Set(["image_view", "view_image"]);
const COLLAB_TOOL_NAMES = new Set(["agent", "subagent", "sub-agent", "task"]);

export function classifyPiToolItemType(toolName: string | undefined): ToolLifecycleItemType {
  const normalized = normalizedToolName(toolName).toLowerCase();
  if (COMMAND_TOOL_NAMES.has(normalized)) return "command_execution";
  if (FILE_CHANGE_TOOL_NAMES.has(normalized)) return "file_change";
  if (WEB_SEARCH_TOOL_NAMES.has(normalized)) return "web_search";
  if (IMAGE_TOOL_NAMES.has(normalized)) return "image_view";
  if (COLLAB_TOOL_NAMES.has(normalized)) return "collab_agent_tool_call";
  if (normalized === "mcp" || normalized.startsWith("mcp_") || normalized.startsWith("mcp.")) {
    return "mcp_tool_call";
  }
  return "dynamic_tool_call";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function path(value: unknown): string | undefined {
  const candidate = string(value)?.trim();
  return candidate && candidate.length <= TOOL_PREVIEW_PATH_MAX_LENGTH ? candidate : undefined;
}

export function extractPiToolOutputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const valueRecord = record(value);
  if (!valueRecord) return undefined;
  if (Array.isArray(valueRecord.content)) {
    const text = valueRecord.content
      .flatMap((entry): string[] => {
        const entryRecord = record(entry);
        const content = entryRecord ? string(entryRecord.text) : undefined;
        return content === undefined ? [] : [content];
      })
      .join("");
    if (text.length > 0) return text;
  }
  return (
    string(valueRecord.output) ??
    string(valueRecord.stdout) ??
    string(valueRecord.stderr) ??
    string(valueRecord.text) ??
    string(valueRecord.message) ??
    string(valueRecord.content)
  );
}

function boundedOutput(value: string | undefined) {
  return value === undefined
    ? undefined
    : truncateToolPreviewText(value, TOOL_PREVIEW_OUTPUT_MAX_LENGTH, 3 / 8);
}

function boundedInput(value: string | undefined) {
  return value === undefined
    ? undefined
    : truncateToolPreviewText(value, TOOL_PREVIEW_INPUT_MAX_LENGTH);
}

function normalizedToolName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= TOOL_NAME_MAX_LENGTH ? trimmed : "Tool";
}

export function canonicalPiToolCallId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 0 && trimmed.length <= TOOL_CALL_ID_MAX_LENGTH) return trimmed;
  return `tool:${NodeCrypto.createHash("sha256").update(value).digest("hex")}`;
}

function commandExitCode(result: unknown, output: string | undefined): number | undefined {
  const resultRecord = record(result);
  const direct = number(resultRecord?.exitCode) ?? number(record(resultRecord?.details)?.exitCode);
  if (direct !== undefined) return direct;
  const match = /(?:Command exited with code|<exited with exit code)\s+(\d+)>?\s*$/iu.exec(
    output ?? "",
  );
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function fileChangeKind(value: unknown): ToolFileChangeKind {
  switch (string(value)?.toLowerCase()) {
    case "add":
    case "create":
      return "add";
    case "update":
    case "edit":
    case "write":
      return "update";
    case "delete":
    case "remove":
      return "delete";
    case "move":
    case "rename":
      return "move";
    default:
      return "unknown";
  }
}

function fileMetadata(value: unknown): ToolFileChangePreview | undefined {
  const valueRecord = record(value);
  if (!valueRecord) return undefined;
  const targetPath = path(valueRecord.relativePath ?? valueRecord.path ?? valueRecord.newPath);
  if (!targetPath) return undefined;
  const sourcePath = path(
    valueRecord.sourceRelativePath ?? valueRecord.sourcePath ?? valueRecord.oldPath,
  );
  const additions = number(valueRecord.additions);
  const deletions = number(valueRecord.deletions);
  return {
    path: targetPath,
    ...(sourcePath ? { sourcePath } : {}),
    changeKind: fileChangeKind(valueRecord.type ?? valueRecord.changeKind),
    ...(additions !== undefined && additions >= 0 ? { additions: Math.floor(additions) } : {}),
    ...(deletions !== undefined && deletions >= 0 ? { deletions: Math.floor(deletions) } : {}),
  };
}

function buildFilePreview(toolName: string, args: Record<string, unknown>, result: unknown) {
  const resultRecord = record(result);
  const details = record(resultRecord?.details);
  const detailFiles = Array.isArray(details?.files) ? details.files : [];
  const targets = Array.isArray(details?.targets) ? details.targets : [];
  const resultFiles = [...targets, ...detailFiles]
    .map(fileMetadata)
    .filter((entry): entry is ToolFileChangePreview => entry !== undefined);
  const targetPath = path(args.path ?? args.file ?? args.filePath ?? args.newPath);
  const sourcePath = path(args.sourcePath ?? args.oldPath ?? args.from);
  if (resultFiles.length === 0 && targetPath) {
    resultFiles.push({
      path: targetPath,
      ...(sourcePath ? { sourcePath } : {}),
      changeKind: fileChangeKind(toolName),
    });
  }
  const boundedFiles = boundToolPreviewFiles(resultFiles);
  const rawDiff = string(details?.patch) ?? string(details?.diff);
  const diffTruncated = rawDiff !== undefined && rawDiff.length > TOOL_PREVIEW_DIFF_MAX_LENGTH;
  const output = boundedOutput(extractPiToolOutputText(result));
  return {
    kind: "file_change" as const,
    files: boundedFiles.files,
    ...(!diffTruncated && rawDiff ? { unifiedDiff: rawDiff } : {}),
    ...(diffTruncated ? { diffTruncated: true } : {}),
    ...(boundedFiles.truncated ? { filesTruncated: true } : {}),
    ...(output
      ? { output: output.value, ...(output.truncated ? { outputTruncated: true } : {}) }
      : {}),
    ...(number(details?.completedFiles) !== undefined
      ? { completedFiles: Math.max(0, Math.floor(number(details?.completedFiles)!)) }
      : {}),
    ...(number(details?.totalFiles) !== undefined
      ? { totalFiles: Math.max(0, Math.floor(number(details?.totalFiles)!)) }
      : {}),
  } satisfies ToolCallPreview;
}

export function projectPiToolCall(input: PiToolCallPreviewInput): PiToolCallProjection {
  const toolName = normalizedToolName(input.toolName);
  const normalized = toolName.toLowerCase();
  const args = input.args ?? {};
  const rawOutput = extractPiToolOutputText(input.result);
  const output = boundedOutput(rawOutput);
  const commandValue = string(args.command) ?? string(args.cmd);
  let itemType = classifyPiToolItemType(toolName);
  let toolPreview: ToolCallPreview;

  if (COMMAND_TOOL_NAMES.has(normalized) && commandValue !== undefined) {
    const command = boundedInput(commandValue)!;
    const exitCode = commandExitCode(input.result, rawOutput);
    toolPreview = {
      kind: "command",
      command: command.value,
      ...(command.truncated ? { commandTruncated: true } : {}),
      ...(path(args.cwd) ? { cwd: path(args.cwd)! } : {}),
      ...(output
        ? { output: output.value, ...(output.truncated ? { outputTruncated: true } : {}) }
        : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  } else if (READ_TOOL_NAMES.has(normalized)) {
    const readPath = path(args.path ?? args.file ?? args.filePath) ?? "Unknown path";
    const offset = number(args.offset);
    const limit = number(args.limit);
    itemType = "dynamic_tool_call";
    toolPreview = {
      kind: "read",
      path: readPath,
      ...(offset !== undefined && offset >= 0 ? { offset: Math.floor(offset) } : {}),
      ...(limit !== undefined && limit >= 0 ? { limit: Math.floor(limit) } : {}),
      ...(output
        ? { content: output.value, ...(output.truncated ? { contentTruncated: true } : {}) }
        : {}),
    };
  } else if (FILE_CHANGE_TOOL_NAMES.has(normalized)) {
    toolPreview = buildFilePreview(normalized, args, input.result);
  } else if (SEARCH_TOOL_NAMES.has(normalized)) {
    itemType = "dynamic_tool_call";
    const query = boundedInput(
      string(args.query) ?? string(args.pattern) ?? string(args.searchTerm),
    );
    toolPreview = {
      kind: "search",
      ...(query
        ? { query: query.value, ...(query.truncated ? { queryTruncated: true } : {}) }
        : {}),
      ...(path(args.path ?? args.cwd) ? { path: path(args.path ?? args.cwd)! } : {}),
      ...(output
        ? { output: output.value, ...(output.truncated ? { outputTruncated: true } : {}) }
        : {}),
    };
  } else {
    if (itemType === "command_execution") itemType = "dynamic_tool_call";
    const genericInput = stableBoundedJson(args, TOOL_PREVIEW_INPUT_MAX_LENGTH);
    const genericOutput =
      input.result === undefined
        ? undefined
        : (output ?? stableBoundedJson(input.result, TOOL_PREVIEW_OUTPUT_MAX_LENGTH));
    toolPreview = {
      kind: "generic",
      toolName,
      input: genericInput.value,
      ...(genericInput.truncated ? { inputTruncated: true } : {}),
      ...(genericOutput
        ? {
            output: genericOutput.value,
            ...(genericOutput.truncated ? { outputTruncated: true } : {}),
          }
        : {}),
    };
  }

  const presentation = deriveToolPreviewPresentation(toolPreview);
  return {
    itemType,
    toolName,
    title: presentation.summary,
    ...(presentation.detail ? { detail: presentation.detail } : {}),
    toolPreview,
  };
}

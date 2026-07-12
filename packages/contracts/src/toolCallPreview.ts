import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TOOL_PREVIEW_OUTPUT_MAX_LENGTH = 32_000;
export const TOOL_PREVIEW_INPUT_MAX_LENGTH = 16_000;
export const TOOL_PREVIEW_DIFF_MAX_LENGTH = 64_000;
export const TOOL_PREVIEW_FILES_MAX_LENGTH = 50;
export const TOOL_NAME_MAX_LENGTH = 256;
export const TOOL_CALL_ID_MAX_LENGTH = 512;
export const TOOL_PREVIEW_PATH_MAX_LENGTH = 1_024;

const OutputText = Schema.String.check(Schema.isMaxLength(TOOL_PREVIEW_OUTPUT_MAX_LENGTH));
const InputText = Schema.String.check(Schema.isMaxLength(TOOL_PREVIEW_INPUT_MAX_LENGTH));
const UnifiedDiff = Schema.String.check(Schema.isMaxLength(TOOL_PREVIEW_DIFF_MAX_LENGTH));
export const ToolName = TrimmedNonEmptyString.check(Schema.isMaxLength(TOOL_NAME_MAX_LENGTH));
export const ToolCallId = TrimmedNonEmptyString.check(Schema.isMaxLength(TOOL_CALL_ID_MAX_LENGTH));
const ToolPath = TrimmedNonEmptyString.check(Schema.isMaxLength(TOOL_PREVIEW_PATH_MAX_LENGTH));

export const ToolFileChangeKind = Schema.Literals(["add", "update", "delete", "move", "unknown"]);
export type ToolFileChangeKind = typeof ToolFileChangeKind.Type;

export const ToolFileChangePreview = Schema.Struct({
  path: ToolPath,
  sourcePath: Schema.optional(ToolPath),
  changeKind: ToolFileChangeKind,
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
});
export type ToolFileChangePreview = typeof ToolFileChangePreview.Type;

const CommandToolCallPreview = Schema.Struct({
  kind: Schema.Literal("command"),
  command: InputText,
  commandTruncated: Schema.optional(Schema.Boolean),
  cwd: Schema.optional(ToolPath),
  output: Schema.optional(OutputText),
  outputTruncated: Schema.optional(Schema.Boolean),
  exitCode: Schema.optional(Schema.Int),
});

const ReadToolCallPreview = Schema.Struct({
  kind: Schema.Literal("read"),
  path: ToolPath,
  offset: Schema.optional(NonNegativeInt),
  limit: Schema.optional(NonNegativeInt),
  content: Schema.optional(OutputText),
  contentTruncated: Schema.optional(Schema.Boolean),
});

const FileChangeToolCallPreview = Schema.Struct({
  kind: Schema.Literal("file_change"),
  files: Schema.Array(ToolFileChangePreview).check(
    Schema.isMaxLength(TOOL_PREVIEW_FILES_MAX_LENGTH),
  ),
  unifiedDiff: Schema.optional(UnifiedDiff),
  diffTruncated: Schema.optional(Schema.Boolean),
  filesTruncated: Schema.optional(Schema.Boolean),
  output: Schema.optional(OutputText),
  outputTruncated: Schema.optional(Schema.Boolean),
  completedFiles: Schema.optional(NonNegativeInt),
  totalFiles: Schema.optional(NonNegativeInt),
});

const SearchToolCallPreview = Schema.Struct({
  kind: Schema.Literal("search"),
  query: Schema.optional(InputText),
  queryTruncated: Schema.optional(Schema.Boolean),
  path: Schema.optional(ToolPath),
  output: Schema.optional(OutputText),
  outputTruncated: Schema.optional(Schema.Boolean),
});

const GenericToolCallPreview = Schema.Struct({
  kind: Schema.Literal("generic"),
  toolName: ToolName,
  input: Schema.optional(InputText),
  output: Schema.optional(OutputText),
  inputTruncated: Schema.optional(Schema.Boolean),
  outputTruncated: Schema.optional(Schema.Boolean),
});

export const ToolCallPreview = Schema.Union([
  CommandToolCallPreview,
  ReadToolCallPreview,
  FileChangeToolCallPreview,
  SearchToolCallPreview,
  GenericToolCallPreview,
]);
export type ToolCallPreview = typeof ToolCallPreview.Type;

// @effect-diagnostics nodeBuiltinImport:off - Image attachments must be encoded for Pi RPC payloads.
// @effect-diagnostics globalDate:off - Provider runtime event timestamps are ISO wall-clock stamps.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import type {
  CanonicalItemType,
  CanonicalRequestType,
  ChatAttachment,
  PiAgentSettings,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  TurnId,
} from "@t3tools/contracts";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  RuntimeItemId as RuntimeItemIdSchema,
  RuntimeRequestId as RuntimeRequestIdSchema,
  RuntimeTaskId as RuntimeTaskIdSchema,
  ThreadId,
  TurnId as TurnIdSchema,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import type { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import {
  makePiRpcRuntime,
  PiResumeCursorSchema,
  type PiResumeCursor,
  type PiRpcRuntimeError,
  type PiRpcRuntimeOptions,
  type PiRpcRuntimeShape,
} from "../piRpcRuntime.ts";
import { buildPiEnvironment, splitPiLaunchArgs } from "../piAgentRuntimeConfig.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("piAgent");
const RPC_RAW_SOURCE = "pi.rpc.event" as const;
const isPiResumeCursor = Schema.is(PiResumeCursorSchema);

interface PiAdapterOptions {
  readonly instanceId?: ProviderInstanceId | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly nativeEventLogger?: EventNdjsonLogger | undefined;
  readonly serverConfig: ServerConfig["Service"];
  readonly makeRuntime?: (
    options: PiRpcRuntimeOptions,
  ) => Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope>;
}

interface PendingUiRequest {
  readonly method: string;
}

interface PiAdapterSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly runtime: PiRpcRuntimeShape;
  eventFiber?: Fiber.Fiber<void, never> | undefined;
  readonly pendingUiRequests: Map<ApprovalRequestId, PendingUiRequest>;
  activeAssistantMessage?: PiAssistantMessageState | undefined;
  assistantMessageCounter: number;
  readonly assistantTextItemsByContentIndex: Map<number, RuntimeItemId>;
  readonly assistantTextByContentIndex: Map<number, string>;
  readonly reasoningItemsByContentIndex: Map<number, RuntimeItemId>;
  readonly reasoningTextByContentIndex: Map<number, string>;
  readonly toolCallsByContentIndex: Map<number, PiToolCallState>;
  readonly toolCallStatesByToolCallId: Map<string, PiToolCallState>;
  readonly toolCallItemIdsByToolCallId: Map<string, RuntimeItemId>;
  readonly toolOutputByToolCallId: Map<string, string>;
  activeCompactionItemId?: RuntimeItemId | undefined;
  session: ProviderSession;
  activeTurnId?: TurnId | undefined;
  activeTurnStarted: boolean;
  activeModel?: PiModelReference | undefined;
  activeThinkingLevel?: string | undefined;
  terminalTurnState?: "failed" | "interrupted" | undefined;
  terminalErrorMessage?: string | undefined;
  interruptRequestedTurnId?: TurnId | undefined;
  discardNextAgentSettled?: boolean | undefined;
  stopped: boolean;
}

interface PiModelReference {
  readonly provider: string;
  readonly modelId: string;
}

interface PiToolCallState {
  readonly itemId: RuntimeItemId;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
  inputBuffer: string;
  input?: Record<string, unknown> | undefined;
  started: boolean;
}

interface PiAssistantMessageState {
  readonly itemId: RuntimeItemId;
  readonly messageKey?: string | undefined;
  started: boolean;
  emittedTextDelta: boolean;
  fallbackText: string;
}

interface PiSubagentStatusMessage {
  readonly sessionId: string;
  readonly name: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly summary?: string | undefined;
}

interface PiTreeEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly role?: string | undefined;
}

interface PiEntriesSnapshot {
  readonly leafId: string | null;
  readonly entries: ReadonlyArray<PiTreeEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringifyForDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function trimDetail(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(): EventId {
  return EventId.make(NodeCrypto.randomUUID());
}

function turnId(): TurnId {
  return TurnIdSchema.make(NodeCrypto.randomUUID());
}

function runtimeItemId(value: string): RuntimeItemId {
  return RuntimeItemIdSchema.make(value || NodeCrypto.randomUUID());
}

function runtimeRequestId(value: string): RuntimeRequestId {
  return RuntimeRequestIdSchema.make(value || NodeCrypto.randomUUID());
}

function runtimeTaskId(value: string) {
  return RuntimeTaskIdSchema.make(value || NodeCrypto.randomUUID());
}

function adapterError(threadId: ThreadId, method: string, error: unknown): ProviderAdapterError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

function parseResumeCursor(value: unknown): PiResumeCursor | undefined {
  return isPiResumeCursor(value) ? value : undefined;
}

function resumeCursorFromPiState(state: Record<string, unknown>, cwd: string): PiResumeCursor {
  const sessionFile = readString(state, "sessionFile");
  const sessionId = readString(state, "sessionId");
  return {
    version: 1,
    ...(sessionFile ? { sessionFile } : {}),
    ...(sessionId ? { sessionId } : {}),
    cwd,
  };
}

function hasPiResumeIdentity(cursor: PiResumeCursor): boolean {
  return cursor.sessionFile !== undefined || cursor.sessionId !== undefined;
}

function piModelFromRecord(value: unknown): PiModelReference | undefined {
  if (!isRecord(value)) return undefined;
  const provider = readString(value, "provider");
  const modelId = readString(value, "id");
  return provider && modelId ? { provider, modelId } : undefined;
}

function piModelFromState(state: Record<string, unknown>): PiModelReference | undefined {
  return piModelFromRecord(state.model);
}

function piModelSlug(model: PiModelReference): string {
  return `${model.provider}/${model.modelId}`;
}

function parsePiModelSlug(value: string): PiModelReference | undefined {
  const separatorIndex = value.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return undefined;
  const provider = value.slice(0, separatorIndex).trim();
  const modelId = value.slice(separatorIndex + 1).trim();
  return provider && modelId ? { provider, modelId } : undefined;
}

function samePiModel(left: PiModelReference | undefined, right: PiModelReference): boolean {
  return left?.provider === right.provider && left.modelId === right.modelId;
}

function modelSlug(input: ProviderSessionStartInput | ProviderSendTurnInput): string | undefined {
  return input.modelSelection?.model;
}

function thinkingLevel(
  input: ProviderSessionStartInput | ProviderSendTurnInput,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(input.modelSelection, "thinking") ??
    getModelSelectionStringOptionValue(input.modelSelection, "thinkingLevel") ??
    getModelSelectionStringOptionValue(input.modelSelection, "effort") ??
    getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
  );
}

function buildPiArgs(input: {
  readonly settings: PiAgentSettings;
  readonly start: ProviderSessionStartInput;
}): ReadonlyArray<string> {
  const args = ["--mode", "rpc"];
  const resumeCursor = parseResumeCursor(input.start.resumeCursor);

  if (input.settings.sessionDir)
    args.push("--session-dir", expandHomePath(input.settings.sessionDir));
  if (resumeCursor?.sessionFile) args.push("--session", resumeCursor.sessionFile);
  else if (resumeCursor?.sessionId) args.push("--session", resumeCursor.sessionId);

  const model = modelSlug(input.start);
  if (model) args.push("--model", model);

  const thinking = thinkingLevel(input.start);
  if (thinking) args.push("--thinking", thinking);

  if (input.settings.projectTrust === "approve") args.push("--approve");
  if (input.settings.projectTrust === "no-approve") args.push("--no-approve");

  args.push(...splitPiLaunchArgs(input.settings.launchArgs));
  return args;
}

function imageInputs(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
  attachmentsDir: string,
): ReadonlyArray<{ type: "image"; data: string; mimeType: string }> | undefined {
  const images = (attachments ?? []).flatMap((attachment) => {
    if (attachment.type !== "image") return [];
    const imagePath = resolveAttachmentPath({ attachmentsDir, attachment });
    if (!imagePath) return [];
    return [
      {
        type: "image" as const,
        data: NodeFS.readFileSync(imagePath).toString("base64"),
        mimeType: attachment.mimeType,
      },
    ];
  });
  return images.length > 0 ? images : undefined;
}

function updateSession(
  context: PiAdapterSessionContext,
  patch: Partial<ProviderSession>,
): ProviderSession {
  context.session = { ...context.session, ...patch, updatedAt: nowIso() };
  return context.session;
}

function reserveTurn(context: PiAdapterSessionContext, activeTurnId: TurnId): void {
  const { lastError: _lastError, ...session } = context.session;
  context.activeTurnId = activeTurnId;
  context.activeTurnStarted = false;
  context.session = {
    ...session,
    status: "running",
    activeTurnId,
    updatedAt: nowIso(),
  };
}

function settleSession(context: PiAdapterSessionContext, errorMessage?: string): void {
  const { activeTurnId: _activeTurnId, lastError: _lastError, ...session } = context.session;
  context.session = {
    ...session,
    status: "ready",
    ...(errorMessage ? { lastError: errorMessage } : {}),
    updatedAt: nowIso(),
  };
}

function closeSessionState(context: PiAdapterSessionContext, errorMessage?: string): void {
  const { activeTurnId: _activeTurnId, lastError: _lastError, ...session } = context.session;
  context.session = {
    ...session,
    status: "closed",
    ...(errorMessage ? { lastError: errorMessage } : {}),
    updatedAt: nowIso(),
  };
}

function resetTerminalTurnState(context: PiAdapterSessionContext): void {
  context.terminalTurnState = undefined;
  context.terminalErrorMessage = undefined;
  context.interruptRequestedTurnId = undefined;
}

function markTerminalTurnState(
  context: PiAdapterSessionContext,
  state: "failed" | "interrupted",
  errorMessage?: string,
): void {
  if (state === "failed" || context.terminalTurnState === undefined) {
    context.terminalTurnState = state;
    context.terminalErrorMessage = errorMessage;
  }
}

function runtimeEventBase(
  context: PiAdapterSessionContext,
  rawEvent: unknown,
): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    eventId: eventId(),
    provider: PROVIDER,
    ...(context.session.providerInstanceId
      ? { providerInstanceId: context.session.providerInstanceId }
      : {}),
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    raw: {
      source: RPC_RAW_SOURCE,
      ...(isRecord(rawEvent) && typeof rawEvent.type === "string" ? { method: rawEvent.type } : {}),
      payload: rawEvent,
    },
  } as Omit<ProviderRuntimeEvent, "type" | "payload">;
}

function toolItemType(toolName: string | undefined): CanonicalItemType {
  const normalized = toolName?.toLowerCase() ?? "";
  if (!normalized) return "dynamic_tool_call";
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("command") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch") ||
    normalized.includes("apply_patch") ||
    normalized.includes("create") ||
    normalized.includes("delete") ||
    normalized.includes("replace")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) return "mcp_tool_call";
  if (normalized.includes("web")) return "web_search";
  if (normalized.includes("image")) return "image_view";
  if (
    normalized.includes("agent") ||
    normalized.includes("subagent") ||
    normalized.includes("sub-agent") ||
    normalized === "task"
  ) {
    return "collab_agent_tool_call";
  }
  return "dynamic_tool_call";
}

function toolTitle(itemType: CanonicalItemType, toolName: string | undefined): string {
  switch (itemType) {
    case "command_execution":
      return "Command run";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "dynamic_tool_call":
      return toolName ?? "Tool call";
    default:
      return toolName ?? "Tool";
  }
}

function summarizeToolInput(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return toolName;
  const normalized = toolName?.toLowerCase() ?? "";
  const command = readString(input, "command") ?? readString(input, "cmd");
  const description = readString(input, "description") ?? readString(input, "summary");
  if (command) {
    return description ?? `${toolName ?? "command"}: ${command}`;
  }

  const path =
    readString(input, "path") ?? readString(input, "file") ?? readString(input, "filePath");
  const pattern = readString(input, "pattern") ?? readString(input, "query");
  const offset = readNumber(input, "offset");
  const limit = readNumber(input, "limit");

  if (normalized === "read" || normalized.includes("read")) {
    const range = [
      offset === undefined ? undefined : `offset ${offset}`,
      limit === undefined ? undefined : `limit ${limit}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    return [toolName ?? "read", path, range ? `(${range})` : undefined].filter(Boolean).join(" ");
  }
  if (normalized.includes("grep") || normalized.includes("find") || normalized.includes("search")) {
    return [toolName, pattern, path ? `in ${path}` : undefined].filter(Boolean).join(" ");
  }
  if (normalized === "ls" || normalized.includes("list")) {
    return [toolName ?? "ls", path].filter(Boolean).join(" ");
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return [toolName, path].filter(Boolean).join(" ");
  }

  return `${toolName ?? "tool"}: ${stringifyForDetail(input) ?? "{}"}`;
}

function toolInputFromEvent(
  rawEvent: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    readRecord(rawEvent, "args") ??
    readRecord(rawEvent, "arguments") ??
    readRecord(rawEvent, "input")
  );
}

function extractToolOutputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.content)) {
    const contentText = value.content
      .flatMap((entry): string[] => {
        if (!isRecord(entry)) return [];
        const text = readString(entry, "text");
        return text ? [text] : [];
      })
      .join("");
    if (contentText.length > 0) return contentText;
  }
  return (
    readString(value, "output") ??
    readString(value, "stdout") ??
    readString(value, "stderr") ??
    readString(value, "text") ??
    readString(value, "message") ??
    readString(value, "content")
  );
}

function outputDelta(previous: string | undefined, next: string): string {
  if (!previous) return next;
  return next.startsWith(previous) ? next.slice(previous.length) : next;
}

function clearTurnStreamState(context: PiAdapterSessionContext): void {
  context.activeAssistantMessage = undefined;
  context.assistantTextItemsByContentIndex.clear();
  context.assistantTextByContentIndex.clear();
  context.reasoningItemsByContentIndex.clear();
  context.reasoningTextByContentIndex.clear();
  context.toolCallsByContentIndex.clear();
  context.toolCallStatesByToolCallId.clear();
  context.toolCallItemIdsByToolCallId.clear();
  context.toolOutputByToolCallId.clear();
}

function requestTypeForUi(method: string): CanonicalRequestType {
  if (method === "confirm") return "unknown";
  return "tool_user_input";
}

function isPiUserInputMethod(method: string): method is "select" | "input" | "editor" {
  return method === "select" || method === "input" || method === "editor";
}

function isPiDialogMethod(method: string): boolean {
  return method === "confirm" || isPiUserInputMethod(method);
}

function ensureTurnStarted(
  context: PiAdapterSessionContext,
  rawEvent: unknown,
): ProviderRuntimeEvent | undefined {
  if (context.activeTurnStarted) return undefined;
  context.activeTurnId ??= turnId();
  context.activeTurnStarted = true;
  updateSession(context, { status: "running", activeTurnId: context.activeTurnId });
  return {
    ...runtimeEventBase(context, rawEvent),
    turnId: context.activeTurnId,
    type: "turn.started",
    payload: {},
  } satisfies ProviderRuntimeEvent;
}

function scopedItemId(
  prefix: string,
  context: PiAdapterSessionContext,
  index: number,
): RuntimeItemId {
  return runtimeItemId(`${prefix}:${context.activeTurnId ?? context.threadId}:${index}`);
}

function messageKeyFromRecord(message: Record<string, unknown> | undefined): string | undefined {
  return message
    ? (readString(message, "id") ?? readString(message, "messageId") ?? readString(message, "uuid"))
    : undefined;
}

function assistantMessageKey(rawEvent: Record<string, unknown>): string | undefined {
  const message = readRecord(rawEvent, "message");
  const assistantMessageEvent = readRecord(rawEvent, "assistantMessageEvent");
  const partial = assistantMessageEvent ? readRecord(assistantMessageEvent, "partial") : undefined;
  return messageKeyFromRecord(message) ?? messageKeyFromRecord(partial);
}

function textFromPiMessage(message: Record<string, unknown> | undefined): string | undefined {
  if (!message) return undefined;
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content
    .flatMap((entry): string[] => {
      if (!isRecord(entry)) return [];
      if (entry.type === "text") {
        const value = readString(entry, "text");
        return value ? [value] : [];
      }
      return [];
    })
    .join("");
  return text.length > 0 ? text : undefined;
}

function piSubagentStatusMessage(
  message: Record<string, unknown>,
): PiSubagentStatusMessage | undefined {
  if (
    readString(message, "role") !== "custom" ||
    readString(message, "customType") !== "subagent-status" ||
    message.display !== true
  ) {
    return undefined;
  }
  const details = readRecord(message, "details");
  if (!details) return undefined;
  const sessionId = readString(details, "sessionId");
  const name = readString(details, "name");
  const status = readString(details, "status");
  if (
    !sessionId ||
    !name ||
    (status !== "completed" && status !== "failed" && status !== "cancelled")
  ) {
    return undefined;
  }
  const summary = trimDetail(readString(details, "summary"));
  return { sessionId, name, status, ...(summary ? { summary } : {}) };
}

function mapPiSubagentStatus(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
  message: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const status = piSubagentStatusMessage(message);
  if (!status) return [];

  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "task.completed",
      payload: {
        taskId: runtimeTaskId(`pi-subagent:${status.sessionId}`),
        status: status.status === "cancelled" ? "stopped" : status.status,
        summary: `${status.name}: ${status.summary ?? `${status.status}.`}`,
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function contentEntryTextAtIndex(
  message: Record<string, unknown> | undefined,
  contentIndex: number,
): string | undefined {
  const content = Array.isArray(message?.content) ? message.content : undefined;
  const entry = content?.[contentIndex];
  if (!isRecord(entry) || entry.type !== "text") return undefined;
  return readString(entry, "text") ?? "";
}

function cumulativeTextFromAssistantEvent(
  assistantMessageEvent: Record<string, unknown>,
  rawEvent: Record<string, unknown>,
  contentIndex: number,
): string | undefined {
  return (
    contentEntryTextAtIndex(readRecord(assistantMessageEvent, "partial"), contentIndex) ??
    contentEntryTextAtIndex(readRecord(rawEvent, "message"), contentIndex)
  );
}

function thinkingEntriesFromAssistantEvent(
  assistantMessageEvent: Record<string, unknown>,
): ReadonlyArray<{ readonly contentIndex: number; readonly text: string }> {
  const partial = readRecord(assistantMessageEvent, "partial");
  const content = Array.isArray(partial?.content) ? partial.content : [];
  return content.flatMap((entry, contentIndex) => {
    if (!isRecord(entry) || entry.type !== "thinking") return [];
    const text = readString(entry, "thinking");
    return text ? [{ contentIndex, text }] : [];
  });
}

function fallbackTextFromRawEvent(rawEvent: Record<string, unknown>): string | undefined {
  const message = readRecord(rawEvent, "message");
  const assistantMessageEvent = readRecord(rawEvent, "assistantMessageEvent");
  const partial = assistantMessageEvent ? readRecord(assistantMessageEvent, "partial") : undefined;
  const error = assistantMessageEvent ? readRecord(assistantMessageEvent, "error") : undefined;
  return textFromPiMessage(message) ?? textFromPiMessage(partial) ?? textFromPiMessage(error);
}

function assistantMessageError(
  assistantMessageEvent: Record<string, unknown>,
): { readonly state: "failed" | "interrupted"; readonly message: string } | undefined {
  if (assistantMessageEvent.type !== "error") return undefined;
  const error = readRecord(assistantMessageEvent, "error");
  const reason = readString(assistantMessageEvent, "reason");
  const message =
    readString(error ?? {}, "errorMessage") ??
    readString(error ?? {}, "message") ??
    readString(assistantMessageEvent, "errorMessage") ??
    (reason === "aborted" ? "Pi generation was interrupted." : "Pi generation failed.");
  return { state: reason === "aborted" ? "interrupted" : "failed", message };
}

function assistantMessageItemId(
  context: PiAdapterSessionContext,
  messageKey: string | undefined,
): RuntimeItemId {
  if (messageKey) return runtimeItemId(`pi-assistant:${messageKey}`);
  const index = context.assistantMessageCounter++;
  return scopedItemId("pi-assistant", context, index);
}

function ensureAssistantMessageState(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): PiAssistantMessageState {
  const messageKey = assistantMessageKey(rawEvent);
  const existing = context.activeAssistantMessage;
  if (existing && (!messageKey || !existing.messageKey || existing.messageKey === messageKey)) {
    return existing;
  }

  const state: PiAssistantMessageState = {
    itemId: assistantMessageItemId(context, messageKey),
    ...(messageKey ? { messageKey } : {}),
    started: false,
    emittedTextDelta: false,
    fallbackText: "",
  };
  context.activeAssistantMessage = state;
  return state;
}

function assistantMessageStartedEvent(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ProviderRuntimeEvent | undefined {
  const state = ensureAssistantMessageState(context, rawEvent);
  if (state.started) return undefined;
  state.started = true;
  return {
    ...runtimeEventBase(context, rawEvent),
    itemId: state.itemId,
    type: "item.started",
    payload: { itemType: "assistant_message", status: "inProgress" },
  } satisfies ProviderRuntimeEvent;
}

function completeAssistantMessageEvents(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const fallbackText = fallbackTextFromRawEvent(rawEvent);
  const state =
    context.activeAssistantMessage ??
    (fallbackText
      ? {
          itemId: assistantMessageItemId(context, assistantMessageKey(rawEvent)),
          ...(assistantMessageKey(rawEvent) ? { messageKey: assistantMessageKey(rawEvent) } : {}),
          started: false,
          emittedTextDelta: false,
          fallbackText,
        }
      : undefined);
  if (!state) return [];
  if (state.fallbackText.length === 0 && fallbackText) state.fallbackText = fallbackText;
  context.activeAssistantMessage = undefined;
  context.assistantTextItemsByContentIndex.clear();
  context.assistantTextByContentIndex.clear();
  if (!state.started && !state.emittedTextDelta && state.fallbackText.length === 0) return [];
  const started = state.started
    ? []
    : [
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: state.itemId,
          type: "item.started",
          payload: { itemType: "assistant_message", status: "inProgress" },
        } satisfies ProviderRuntimeEvent,
      ];
  return [
    ...started,
    {
      ...runtimeEventBase(context, rawEvent),
      itemId: state.itemId,
      type: "item.completed",
      payload: {
        itemType: "assistant_message",
        status: "completed",
        ...(state.fallbackText.length > 0 ? { detail: state.fallbackText } : {}),
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function assistantTextItemId(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
  contentIndex: number,
): RuntimeItemId {
  const existing = context.assistantTextItemsByContentIndex.get(contentIndex);
  if (existing) return existing;
  const state = ensureAssistantMessageState(context, rawEvent);
  context.assistantTextItemsByContentIndex.set(contentIndex, state.itemId);
  return state.itemId;
}

function reasoningItemId(context: PiAdapterSessionContext, contentIndex: number): RuntimeItemId {
  const existing = context.reasoningItemsByContentIndex.get(contentIndex);
  if (existing) return existing;
  const itemId = scopedItemId("pi-reasoning", context, contentIndex);
  context.reasoningItemsByContentIndex.set(contentIndex, itemId);
  return itemId;
}

function mapPiReasoningSnapshots(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
  assistantMessageEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  return thinkingEntriesFromAssistantEvent(assistantMessageEvent).flatMap(
    ({ contentIndex, text }) => {
      const previous = context.reasoningTextByContentIndex.get(contentIndex);
      const delta = outputDelta(previous, text);
      context.reasoningTextByContentIndex.set(contentIndex, text);
      if (delta.length === 0) return [];
      const itemId = reasoningItemId(context, contentIndex);
      return [
        {
          ...runtimeEventBase(context, rawEvent),
          itemId,
          type: "content.delta",
          payload: { streamKind: "reasoning_text", delta, contentIndex },
        } satisfies ProviderRuntimeEvent,
      ];
    },
  );
}

function hasReasoningDeltaForContentIndex(
  events: ReadonlyArray<ProviderRuntimeEvent>,
  contentIndex: number,
): boolean {
  return events.some(
    (event) =>
      event.type === "content.delta" &&
      event.payload.streamKind === "reasoning_text" &&
      event.payload.contentIndex === contentIndex,
  );
}

function toolCallIdFromToolCall(toolCall: Record<string, unknown> | undefined): string | undefined {
  return toolCall ? readString(toolCall, "id") : undefined;
}

function toolNameFromToolCall(toolCall: Record<string, unknown> | undefined): string | undefined {
  return toolCall ? readString(toolCall, "name") : undefined;
}

function toolArgumentsFromToolCall(
  toolCall: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return toolCall ? readRecord(toolCall, "arguments") : undefined;
}

function toolCallFromAssistantEvent(
  assistantMessageEvent: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const directToolCall = readRecord(assistantMessageEvent, "toolCall");
  if (directToolCall) return directToolCall;
  const partial = readRecord(assistantMessageEvent, "partial");
  const contentIndex = readNumber(assistantMessageEvent, "contentIndex");
  const content = Array.isArray(partial?.content) ? partial.content : undefined;
  const entry = contentIndex === undefined ? undefined : content?.[contentIndex];
  return isRecord(entry) && entry.type === "toolCall" ? entry : undefined;
}

function getOrCreateToolCallState(
  context: PiAdapterSessionContext,
  contentIndex: number,
  toolCall: Record<string, unknown> | undefined,
): PiToolCallState {
  const toolCallId = toolCallIdFromToolCall(toolCall);
  const existing =
    context.toolCallsByContentIndex.get(contentIndex) ??
    (toolCallId ? context.toolCallStatesByToolCallId.get(toolCallId) : undefined);
  const mappedItemId = toolCallId ? context.toolCallItemIdsByToolCallId.get(toolCallId) : undefined;
  const itemId = existing?.itemId ?? mappedItemId ?? scopedItemId("pi-tool", context, contentIndex);
  const toolName = toolNameFromToolCall(toolCall) ?? existing?.toolName;
  const input = toolArgumentsFromToolCall(toolCall) ?? existing?.input;
  const state: PiToolCallState = existing ?? {
    itemId,
    inputBuffer: "",
    started: false,
  };
  state.toolCallId = toolCallId ?? state.toolCallId;
  state.toolName = toolName;
  state.input = input;
  context.toolCallsByContentIndex.set(contentIndex, state);
  if (state.toolCallId) {
    context.toolCallItemIdsByToolCallId.set(state.toolCallId, state.itemId);
    context.toolCallStatesByToolCallId.set(state.toolCallId, state);
  }
  return state;
}

function toolCallStateForExecution(
  context: PiAdapterSessionContext,
  toolCallId: string,
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
): PiToolCallState {
  const existingEntry = context.toolCallStatesByToolCallId.get(toolCallId);
  const itemId =
    existingEntry?.itemId ??
    context.toolCallItemIdsByToolCallId.get(toolCallId) ??
    runtimeItemId(toolCallId);
  const state = existingEntry ?? {
    itemId,
    inputBuffer: "",
    started: false,
  };
  state.toolCallId = toolCallId;
  state.toolName = toolName ?? state.toolName;
  state.input = input ?? state.input;
  context.toolCallItemIdsByToolCallId.set(toolCallId, state.itemId);
  context.toolCallStatesByToolCallId.set(toolCallId, state);
  return state;
}

function toolPayload(input: {
  readonly toolCallId: string | undefined;
  readonly toolName: string | undefined;
  readonly input: Record<string, unknown> | undefined;
  readonly status: "inProgress" | "completed" | "failed";
  readonly partialResult?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
}) {
  const itemType = toolItemType(input.toolName);
  const command =
    itemType === "command_execution" && input.input
      ? (readString(input.input, "command") ?? readString(input.input, "cmd"))
      : undefined;
  const detail = trimDetail(
    summarizeToolInput(input.toolName, input.input) ??
      extractToolOutputText(input.result) ??
      extractToolOutputText(input.partialResult),
  );
  const outputText =
    extractToolOutputText(input.result) ?? extractToolOutputText(input.partialResult);
  return {
    itemType,
    status: input.status,
    title: toolTitle(itemType, input.toolName),
    ...(detail ? { detail } : {}),
    data: {
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(command ? { command } : {}),
      ...(input.input ? { input: input.input } : {}),
      ...(input.partialResult !== undefined ? { partialResult: input.partialResult } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(outputText !== undefined ? { outputText } : {}),
      ...(input.isError !== undefined ? { isError: input.isError } : {}),
    },
  } satisfies ProviderRuntimeEvent["payload"];
}

function outputStreamKind(
  itemType: CanonicalItemType,
): "command_output" | "file_change_output" | undefined {
  if (itemType === "command_execution") return "command_output";
  if (itemType === "file_change") return "file_change_output";
  return undefined;
}

function mapPiMessageUpdate(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const assistantMessageEvent = readRecord(rawEvent, "assistantMessageEvent");
  if (!assistantMessageEvent) return [];

  const reasoningEvents = mapPiReasoningSnapshots(context, rawEvent, assistantMessageEvent);
  const contentIndex = readNumber(assistantMessageEvent, "contentIndex") ?? 0;
  switch (assistantMessageEvent.type) {
    case "text_start": {
      const started = assistantMessageStartedEvent(context, rawEvent);
      assistantTextItemId(context, rawEvent, contentIndex);
      return [...reasoningEvents, ...(started ? [started] : [])];
    }
    case "text_delta": {
      const cumulativeText = cumulativeTextFromAssistantEvent(
        assistantMessageEvent,
        rawEvent,
        contentIndex,
      );
      const delta = cumulativeText
        ? outputDelta(context.assistantTextByContentIndex.get(contentIndex), cumulativeText)
        : readString(assistantMessageEvent, "delta");
      if (!delta) return reasoningEvents;
      if (cumulativeText !== undefined) {
        context.assistantTextByContentIndex.set(contentIndex, cumulativeText);
      } else {
        context.assistantTextByContentIndex.set(
          contentIndex,
          `${context.assistantTextByContentIndex.get(contentIndex) ?? ""}${delta}`,
        );
      }
      const started = assistantMessageStartedEvent(context, rawEvent);
      const state = ensureAssistantMessageState(context, rawEvent);
      state.emittedTextDelta = true;
      return [
        ...reasoningEvents,
        ...(started ? [started] : []),
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: assistantTextItemId(context, rawEvent, contentIndex),
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta, contentIndex },
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "text_end": {
      const content = readString(assistantMessageEvent, "content");
      if (content) {
        const state = ensureAssistantMessageState(context, rawEvent);
        state.fallbackText += content;
        context.assistantTextByContentIndex.set(contentIndex, content);
      }
      context.assistantTextItemsByContentIndex.delete(contentIndex);
      return reasoningEvents;
    }
    case "thinking_start": {
      reasoningItemId(context, contentIndex);
      return reasoningEvents;
    }
    case "thinking_delta": {
      const delta = readString(assistantMessageEvent, "delta");
      if (!delta) return reasoningEvents;
      if (hasReasoningDeltaForContentIndex(reasoningEvents, contentIndex)) return reasoningEvents;
      context.reasoningTextByContentIndex.set(
        contentIndex,
        `${context.reasoningTextByContentIndex.get(contentIndex) ?? ""}${delta}`,
      );
      return [
        ...reasoningEvents,
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: reasoningItemId(context, contentIndex),
          type: "content.delta",
          payload: { streamKind: "reasoning_text", delta, contentIndex },
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "thinking_end": {
      context.reasoningItemsByContentIndex.delete(contentIndex);
      return reasoningEvents;
    }
    case "toolcall_start": {
      const toolCall = toolCallFromAssistantEvent(assistantMessageEvent);
      const state = getOrCreateToolCallState(context, contentIndex, toolCall);
      state.started = true;
      return [
        ...reasoningEvents,
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: state.itemId,
          type: "item.started",
          payload: toolPayload({
            toolCallId: state.toolCallId,
            toolName: state.toolName,
            input: state.input,
            status: "inProgress",
          }),
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "toolcall_delta": {
      const toolCall = toolCallFromAssistantEvent(assistantMessageEvent);
      const state = getOrCreateToolCallState(context, contentIndex, toolCall);
      const delta = readString(assistantMessageEvent, "delta");
      if (delta) {
        state.inputBuffer += delta;
        state.input = tryParseJsonRecord(state.inputBuffer) ?? state.input;
      }
      const eventType = state.started ? "item.updated" : "item.started";
      state.started = true;
      return [
        ...reasoningEvents,
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: state.itemId,
          type: eventType,
          payload: toolPayload({
            toolCallId: state.toolCallId,
            toolName: state.toolName,
            input: state.input,
            status: "inProgress",
          }),
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "toolcall_end": {
      const toolCall = toolCallFromAssistantEvent(assistantMessageEvent);
      const state = getOrCreateToolCallState(context, contentIndex, toolCall);
      state.input = toolArgumentsFromToolCall(toolCall) ?? state.input;
      const eventType = state.started ? "item.updated" : "item.started";
      state.started = true;
      return [
        ...reasoningEvents,
        {
          ...runtimeEventBase(context, rawEvent),
          itemId: state.itemId,
          type: eventType,
          payload: toolPayload({
            toolCallId: state.toolCallId,
            toolName: state.toolName,
            input: state.input,
            status: "inProgress",
          }),
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "done": {
      return completeAssistantMessageEvents(context, rawEvent);
    }
    case "error": {
      const error = assistantMessageError(assistantMessageEvent);
      if (error) markTerminalTurnState(context, error.state, error.message);
      return completeAssistantMessageEvents(context, rawEvent);
    }
    default:
      return reasoningEvents;
  }
}

function mapPiToolExecution(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const toolCallId = readString(rawEvent, "toolCallId") ?? NodeCrypto.randomUUID();
  const toolName = readString(rawEvent, "toolName");
  const input = toolInputFromEvent(rawEvent);
  const state = toolCallStateForExecution(context, toolCallId, toolName, input);
  const itemType = toolItemType(state.toolName);
  const partialResult = rawEvent.partialResult;
  const result = rawEvent.result;
  const outputText = extractToolOutputText(partialResult) ?? extractToolOutputText(result);
  const outputTextDelta = outputText
    ? outputDelta(context.toolOutputByToolCallId.get(toolCallId), outputText)
    : undefined;
  if (outputText) context.toolOutputByToolCallId.set(toolCallId, outputText);

  const lifecycle =
    rawEvent.type === "tool_execution_start"
      ? "item.started"
      : rawEvent.type === "tool_execution_update"
        ? "item.updated"
        : "item.completed";
  const status =
    rawEvent.type === "tool_execution_end"
      ? rawEvent.isError
        ? "failed"
        : "completed"
      : "inProgress";

  const events: ProviderRuntimeEvent[] = [
    {
      ...runtimeEventBase(context, rawEvent),
      itemId: state.itemId,
      type: lifecycle,
      payload: toolPayload({
        toolCallId: state.toolCallId,
        toolName: state.toolName,
        input: state.input,
        status,
        partialResult,
        result,
        ...(typeof rawEvent.isError === "boolean" ? { isError: rawEvent.isError } : {}),
      }),
    } satisfies ProviderRuntimeEvent,
  ];

  const streamKind = outputStreamKind(itemType);
  if (streamKind && outputTextDelta && outputTextDelta.length > 0) {
    events.push({
      ...runtimeEventBase(context, rawEvent),
      itemId: state.itemId,
      type: "content.delta",
      payload: { streamKind, delta: outputTextDelta },
    } satisfies ProviderRuntimeEvent);
  }

  if (rawEvent.type === "tool_execution_end") {
    context.toolOutputByToolCallId.delete(toolCallId);
  }
  return events;
}

function mapPiQueueUpdate(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const steering = stringArray(rawEvent.steering);
  const followUp = stringArray(rawEvent.followUp);
  const state = context.activeTurnId
    ? "running"
    : steering.length > 0 || followUp.length > 0
      ? "waiting"
      : "ready";
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "session.state.changed",
      payload: {
        state,
        reason: "queue_update",
        detail: { steeringCount: steering.length, followUpCount: followUp.length },
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function compactionItemId(context: PiAdapterSessionContext): RuntimeItemId {
  const existing = context.activeCompactionItemId;
  if (existing) return existing;
  const itemId = runtimeItemId(`pi-compaction:${context.threadId}:${NodeCrypto.randomUUID()}`);
  context.activeCompactionItemId = itemId;
  return itemId;
}

function compactionReason(rawEvent: Record<string, unknown>): string {
  return readString(rawEvent, "reason") ?? "compaction";
}

function mapPiCompactionStart(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const reason = compactionReason(rawEvent);
  const itemId = compactionItemId(context);
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      itemId,
      type: "item.started",
      payload: {
        itemType: "context_compaction",
        status: "inProgress",
        title: "Context compaction",
        detail: reason,
        data: { reason },
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function mapPiCompactionEnd(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const reason = compactionReason(rawEvent);
  const itemId = compactionItemId(context);
  const aborted = readBoolean(rawEvent, "aborted") === true;
  const errorMessage = readString(rawEvent, "errorMessage");
  context.activeCompactionItemId = undefined;
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      itemId,
      type: "item.completed",
      payload: {
        itemType: "context_compaction",
        status: aborted ? "declined" : errorMessage ? "failed" : "completed",
        title: "Context compaction",
        detail: errorMessage ?? reason,
        data: {
          reason,
          result: rawEvent.result,
          aborted,
          willRetry: readBoolean(rawEvent, "willRetry") ?? false,
          ...(errorMessage ? { errorMessage } : {}),
        },
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function retryTaskId(context: PiAdapterSessionContext, rawEvent: Record<string, unknown>) {
  return runtimeTaskId(`pi-auto-retry:${context.threadId}:${readNumber(rawEvent, "attempt") ?? 0}`);
}

function mapPiAutoRetryStart(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const attempt = readNumber(rawEvent, "attempt") ?? 0;
  const maxAttempts = readNumber(rawEvent, "maxAttempts") ?? 0;
  const delayMs = readNumber(rawEvent, "delayMs") ?? 0;
  const errorMessage = readString(rawEvent, "errorMessage") ?? "Pi auto retry started.";
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "task.started",
      payload: {
        taskId: retryTaskId(context, rawEvent),
        taskType: "auto_retry",
        description: `Retrying after provider error (${attempt}/${maxAttempts})`,
      },
    } satisfies ProviderRuntimeEvent,
    {
      ...runtimeEventBase(context, rawEvent),
      type: "task.progress",
      payload: {
        taskId: retryTaskId(context, rawEvent),
        description: errorMessage,
        summary: delayMs > 0 ? `Retrying in ${Math.round(delayMs / 1000)}s` : "Retrying now",
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function mapPiAutoRetryEnd(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const success = readBoolean(rawEvent, "success") === true;
  const finalError = readString(rawEvent, "finalError");
  if (success) {
    resetTerminalTurnState(context);
  } else {
    markTerminalTurnState(context, "failed", finalError ?? "Pi auto retry failed.");
  }
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "task.completed",
      payload: {
        taskId: retryTaskId(context, rawEvent),
        status: success ? "completed" : "failed",
        summary: success ? "Retry succeeded" : (finalError ?? "Retry failed"),
      },
    } satisfies ProviderRuntimeEvent,
  ];
}

function mapPiSessionInfoChanged(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const name = readString(rawEvent, "name");
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "thread.metadata.updated",
      payload: { ...(name ? { name } : {}), metadata: { sessionName: name ?? null } },
    } satisfies ProviderRuntimeEvent,
  ];
}

function mapPiThinkingLevelChanged(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const level = readString(rawEvent, "level") ?? "default";
  context.activeThinkingLevel = level;
  return [
    {
      ...runtimeEventBase(context, rawEvent),
      type: "session.configured",
      payload: { config: { thinkingLevel: level } },
    } satisfies ProviderRuntimeEvent,
  ];
}

function settlePiTurn(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
  sessionReadyReason = "agent_settled",
): ReadonlyArray<ProviderRuntimeEvent> {
  const activeTurnId = context.activeTurnId;
  if (!activeTurnId) {
    if (context.session.status === "running") settleSession(context);
    resetTerminalTurnState(context);
    return [];
  }

  const assistantCompletions = completeAssistantMessageEvents(context, rawEvent);
  const state =
    context.terminalTurnState ??
    (context.interruptRequestedTurnId === activeTurnId ? "interrupted" : "completed");
  const errorMessage = context.terminalErrorMessage;
  context.activeTurnId = undefined;
  context.activeTurnStarted = false;
  clearTurnStreamState(context);
  context.pendingUiRequests.clear();
  settleSession(context, state === "failed" ? errorMessage : undefined);
  resetTerminalTurnState(context);

  return [
    ...assistantCompletions,
    ...(state === "failed"
      ? [
          {
            ...runtimeEventBase(context, rawEvent),
            turnId: activeTurnId,
            type: "runtime.error",
            payload: {
              message: errorMessage ?? "Pi generation failed.",
              class: "provider_error",
            },
          } satisfies ProviderRuntimeEvent,
        ]
      : []),
    {
      ...runtimeEventBase(context, rawEvent),
      turnId: activeTurnId,
      type: "turn.completed",
      payload: {
        state,
        ...(errorMessage && state !== "completed" ? { errorMessage } : {}),
      },
    } satisfies ProviderRuntimeEvent,
    {
      ...runtimeEventBase(context, rawEvent),
      type: "session.state.changed",
      payload: { state: "ready", reason: sessionReadyReason },
    } satisfies ProviderRuntimeEvent,
  ];
}

function processExitDetail(rawEvent: Record<string, unknown>): string {
  const code = readNumber(rawEvent, "code");
  const signal = readString(rawEvent, "signal");
  return `Pi RPC process exited${code === undefined ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
}

function mapPiProcessExit(
  context: PiAdapterSessionContext,
  rawEvent: Record<string, unknown>,
): ReadonlyArray<ProviderRuntimeEvent> {
  const activeTurnId = context.activeTurnId;
  const code = readNumber(rawEvent, "code");
  const signal = readString(rawEvent, "signal");
  const exitKind =
    context.stopped || (activeTurnId === undefined && code === 0 && signal === undefined)
      ? "graceful"
      : "error";
  const detail = processExitDetail(rawEvent);
  const terminalState =
    context.terminalTurnState ??
    (context.interruptRequestedTurnId === activeTurnId ? "interrupted" : "failed");
  const terminalError = context.terminalErrorMessage ?? detail;
  const assistantCompletions = completeAssistantMessageEvents(context, rawEvent);

  context.activeTurnId = undefined;
  context.activeTurnStarted = false;
  clearTurnStreamState(context);
  context.pendingUiRequests.clear();
  closeSessionState(context, exitKind === "error" ? terminalError : undefined);
  resetTerminalTurnState(context);

  return [
    ...assistantCompletions,
    ...(activeTurnId
      ? [
          ...(terminalState === "failed"
            ? [
                {
                  ...runtimeEventBase(context, rawEvent),
                  turnId: activeTurnId,
                  type: "runtime.error",
                  payload: { message: terminalError, class: "transport_error" },
                } satisfies ProviderRuntimeEvent,
              ]
            : []),
          {
            ...runtimeEventBase(context, rawEvent),
            turnId: activeTurnId,
            type: "turn.completed",
            payload: {
              state: terminalState,
              ...(terminalState === "failed" ? { errorMessage: terminalError } : {}),
            },
          } satisfies ProviderRuntimeEvent,
        ]
      : []),
    ...(exitKind === "error"
      ? [
          {
            ...runtimeEventBase(context, rawEvent),
            type: "runtime.error",
            payload: { message: detail, class: "transport_error" },
          } satisfies ProviderRuntimeEvent,
        ]
      : []),
    {
      ...runtimeEventBase(context, rawEvent),
      type: "session.exited",
      payload: { reason: detail, exitKind },
    } satisfies ProviderRuntimeEvent,
  ];
}

function mapPiEvent(
  context: PiAdapterSessionContext,
  rawEvent: unknown,
): ReadonlyArray<ProviderRuntimeEvent> {
  if (!isRecord(rawEvent)) return [];

  switch (rawEvent.type) {
    case "agent_start": {
      context.discardNextAgentSettled = undefined;
      if (!context.activeTurnId) resetTerminalTurnState(context);
      clearTurnStreamState(context);
      const started = ensureTurnStarted(context, rawEvent);
      return started ? [started] : [];
    }
    case "turn_start": {
      const started = ensureTurnStarted(context, rawEvent);
      return started ? [started] : [];
    }
    case "turn_end":
      return [];
    case "agent_end": {
      const assistantCompletions = completeAssistantMessageEvents(context, rawEvent);
      clearTurnStreamState(context);
      return assistantCompletions;
    }
    case "agent_settled":
      if (context.discardNextAgentSettled) {
        context.discardNextAgentSettled = undefined;
        return [];
      }
      return settlePiTurn(context, rawEvent);
    case "message_start": {
      const message = readRecord(rawEvent, "message");
      if (message?.role !== "assistant") return [];
      const started = assistantMessageStartedEvent(context, rawEvent);
      return started ? [started] : [];
    }
    case "message_update":
      return mapPiMessageUpdate(context, rawEvent);
    case "message_end": {
      const message = readRecord(rawEvent, "message");
      if (!message) return [];
      if (message.role === "assistant") return completeAssistantMessageEvents(context, rawEvent);
      return mapPiSubagentStatus(context, rawEvent, message);
    }
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return mapPiToolExecution(context, rawEvent);
    case "queue_update":
      return mapPiQueueUpdate(context, rawEvent);
    case "compaction_start":
      return mapPiCompactionStart(context, rawEvent);
    case "compaction_end":
      return mapPiCompactionEnd(context, rawEvent);
    case "auto_retry_start":
      return mapPiAutoRetryStart(context, rawEvent);
    case "auto_retry_end":
      return mapPiAutoRetryEnd(context, rawEvent);
    case "session_info_changed":
      return mapPiSessionInfoChanged(context, rawEvent);
    case "thinking_level_changed":
      return mapPiThinkingLevelChanged(context, rawEvent);
    case "extension_ui_request": {
      const id = readString(rawEvent, "id") ?? NodeCrypto.randomUUID();
      const method = readString(rawEvent, "method") ?? "unknown";
      if (method === "notify") {
        const message = readString(rawEvent, "message");
        if (!message) return [];
        if (rawEvent.notifyType === "error") {
          return [
            {
              ...runtimeEventBase(context, rawEvent),
              type: "runtime.error",
              payload: { message, class: "provider_error" },
            } satisfies ProviderRuntimeEvent,
          ];
        }
        return [
          {
            ...runtimeEventBase(context, rawEvent),
            type: "runtime.warning",
            payload: { message },
          } satisfies ProviderRuntimeEvent,
        ];
      }

      if (
        method === "setStatus" ||
        method === "setTitle" ||
        method === "setWidget" ||
        method === "set_editor_text"
      ) {
        return [];
      }

      if (isPiDialogMethod(method)) {
        context.pendingUiRequests.set(ApprovalRequestId.make(id), { method });
      }
      if (isPiUserInputMethod(method)) {
        const title = readString(rawEvent, "title") ?? "Pi input";
        const options = Array.isArray(rawEvent.options)
          ? rawEvent.options.filter((option): option is string => typeof option === "string")
          : [];
        return [
          {
            ...runtimeEventBase(context, rawEvent),
            requestId: runtimeRequestId(id),
            type: "user-input.requested",
            payload: {
              questions: [
                {
                  id,
                  header: method,
                  question: title,
                  options: options.map((option) => ({ label: option, description: option })),
                },
              ],
            },
          } satisfies ProviderRuntimeEvent,
        ];
      }

      return [
        {
          ...runtimeEventBase(context, rawEvent),
          requestId: runtimeRequestId(id),
          type: "request.opened",
          payload: {
            requestType: requestTypeForUi(method),
            detail: readString(rawEvent, "message") ?? readString(rawEvent, "title") ?? method,
            args: rawEvent,
          },
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "extension_error":
    case "parse_error":
      return [
        {
          ...runtimeEventBase(context, rawEvent),
          type: "runtime.error",
          payload: {
            message:
              readString(rawEvent, "message") ??
              readString(rawEvent, "error") ??
              "Pi runtime error",
            class: "provider_error",
          },
        } satisfies ProviderRuntimeEvent,
      ];
    case "process_error": {
      const message =
        readString(rawEvent, "message") ?? readString(rawEvent, "error") ?? "Pi runtime error";
      markTerminalTurnState(context, "failed", message);
      return [
        {
          ...runtimeEventBase(context, rawEvent),
          type: "runtime.error",
          payload: { message, class: "transport_error" },
        } satisfies ProviderRuntimeEvent,
      ];
    }
    case "process_exit":
      return mapPiProcessExit(context, rawEvent);
    default:
      return [];
  }
}

function selectUserInputValue(
  answers: ProviderUserInputAnswers,
  requestId: ApprovalRequestId,
): string | undefined {
  const byId = answers[requestId];
  if (typeof byId === "string") return byId;
  const answer = answers.answer;
  if (typeof answer === "string") return answer;
  const first = Object.values(answers).find((value): value is string => typeof value === "string");
  return first;
}

function readPiEntriesSnapshot(value: unknown): PiEntriesSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined;
  const entries = value.entries.flatMap((entry): PiTreeEntry[] => {
    if (!isRecord(entry)) return [];
    const id = readString(entry, "id");
    const type = readString(entry, "type");
    if (!id || !type) return [];
    const parentId =
      entry.parentId === null || typeof entry.parentId === "string" ? entry.parentId : null;
    const role =
      readString(readRecord(entry, "message") ?? {}, "role") ?? readString(entry, "role");
    return [{ id, type, parentId, ...(role ? { role } : {}) }];
  });
  return {
    leafId: value.leafId === null || typeof value.leafId === "string" ? value.leafId : null,
    entries,
  };
}

function rollbackTargetId(snapshot: PiEntriesSnapshot, numTurns: number): string | undefined {
  if (!snapshot.leafId || numTurns <= 0) return undefined;
  const entriesById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const path: PiTreeEntry[] = [];
  const visited = new Set<string>();
  let cursor: string | null | undefined = snapshot.leafId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const entry = entriesById.get(cursor);
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentId;
  }
  const userMessages = path
    .toReversed()
    .filter((entry) => entry.type === "message" && entry.role === "user");
  return userMessages.at(-numTurns)?.id;
}

function threadSnapshotFromEntries(
  threadId: ThreadId,
  result: { readonly entries?: ReadonlyArray<unknown> },
): ProviderThreadSnapshot {
  return {
    threadId,
    turns: [
      {
        id: TurnIdSchema.make(`${threadId}-snapshot`),
        items: result.entries ?? [],
      },
    ],
  };
}

export const __PiAdapterTestKit = {
  makeContext(input?: { readonly threadId?: ThreadId; readonly turnId?: TurnId }) {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = input?.threadId ?? ThreadId.make("pi-thread-test");
    const session: ProviderSession = {
      provider: PROVIDER,
      status: "running",
      runtimeMode: "full-access",
      threadId,
      ...(input?.turnId ? { activeTurnId: input.turnId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    return {
      threadId,
      scope: {} as Scope.Closeable,
      runtime: {} as PiRpcRuntimeShape,
      pendingUiRequests: new Map(),
      assistantMessageCounter: 0,
      assistantTextItemsByContentIndex: new Map(),
      assistantTextByContentIndex: new Map(),
      reasoningItemsByContentIndex: new Map(),
      reasoningTextByContentIndex: new Map(),
      toolCallsByContentIndex: new Map(),
      toolCallStatesByToolCallId: new Map(),
      toolCallItemIdsByToolCallId: new Map(),
      toolOutputByToolCallId: new Map(),
      session,
      ...(input?.turnId ? { activeTurnId: input.turnId } : {}),
      activeTurnStarted: false,
      stopped: false,
    } satisfies PiAdapterSessionContext;
  },
  mapEvent: mapPiEvent,
};

export const makePiAdapter = (
  settings: PiAgentSettings,
  options: PiAdapterOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const parentScope = yield* Scope.Scope;
    const sessionsRef = yield* Ref.make(new Map<ThreadId, PiAdapterSessionContext>());
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const emitRuntimeEvent = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const logNativeEvent = (context: PiAdapterSessionContext, event: unknown) => {
      if (!options.nativeEventLogger) return Effect.void;
      const observedAt = nowIso();
      return options.nativeEventLogger
        .write(
          {
            observedAt,
            event: {
              id: NodeCrypto.randomUUID(),
              kind: "notification",
              provider: PROVIDER,
              ...(context.session.providerInstanceId
                ? { providerInstanceId: context.session.providerInstanceId }
                : {}),
              createdAt: observedAt,
              method: isRecord(event) && typeof event.type === "string" ? event.type : "unknown",
              threadId: context.threadId,
              payload: event,
            },
          },
          context.threadId,
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to write native Pi RPC event.", {
              cause,
              threadId: context.threadId,
            }),
          ),
        );
    };

    const getThreadLock = (threadId: ThreadId) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (locks) => {
        const existing = Option.fromNullishOr(locks.get(threadId));
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((lock) => {
                const next = new Map(locks);
                next.set(threadId, lock);
                return [lock, next] as const;
              }),
            ),
          onSome: (lock) => Effect.succeed([lock, locks] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadLock(threadId), (lock) => lock.withPermit(effect));

    const getSessionContext = (threadId: ThreadId) =>
      Ref.get(sessionsRef).pipe(
        Effect.flatMap((sessions) => {
          const context = sessions.get(threadId);
          return context
            ? Effect.succeed(context)
            : Effect.fail(
                new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
              );
        }),
      );

    const getOpenSessionContext = (threadId: ThreadId) =>
      getSessionContext(threadId).pipe(
        Effect.flatMap((context) =>
          context.stopped || context.session.status === "closed"
            ? Effect.fail(new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId }))
            : Effect.succeed(context),
        ),
      );

    const closeSession = (context: PiAdapterSessionContext) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        context.pendingUiRequests.clear();
        if (context.eventFiber) yield* Fiber.interrupt(context.eventFiber).pipe(Effect.ignore);
        yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
        yield* Ref.update(sessionsRef, (sessions) => {
          if (sessions.get(context.threadId) !== context) return sessions;
          const next = new Map(sessions);
          next.delete(context.threadId);
          return next;
        });
      });

    yield* Scope.addFinalizer(
      parentScope,
      Ref.get(sessionsRef).pipe(
        Effect.flatMap((sessions) =>
          Effect.forEach(sessions.values(), closeSession, { discard: true }),
        ),
        Effect.ignore,
      ),
    );

    const applyPiConfiguration = (context: PiAdapterSessionContext, input: ProviderSendTurnInput) =>
      Effect.gen(function* () {
        let changed = false;
        const selectedModelSlug = modelSlug(input);
        if (selectedModelSlug) {
          const selectedModel = parsePiModelSlug(selectedModelSlug);
          if (!selectedModel) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "set_model",
              detail: "Pi model selection must use the 'provider/model' format.",
            });
          }
          if (!samePiModel(context.activeModel, selectedModel)) {
            const response = yield* context.runtime
              .request<Record<string, unknown>>({
                type: "set_model",
                provider: selectedModel.provider,
                modelId: selectedModel.modelId,
              })
              .pipe(Effect.mapError((error) => adapterError(context.threadId, "set_model", error)));
            context.activeModel = piModelFromRecord(response) ?? selectedModel;
            context.activeThinkingLevel = undefined;
            updateSession(context, { model: selectedModelSlug });
            changed = true;
          }
        }

        const selectedThinkingLevel = thinkingLevel(input);
        if (selectedThinkingLevel && selectedThinkingLevel !== context.activeThinkingLevel) {
          yield* context.runtime
            .request({ type: "set_thinking_level", level: selectedThinkingLevel })
            .pipe(
              Effect.mapError((error) =>
                adapterError(context.threadId, "set_thinking_level", error),
              ),
            );
          context.activeThinkingLevel = undefined;
          changed = true;
        }

        if (changed) {
          const state = yield* context.runtime
            .request<Record<string, unknown>>({ type: "get_state" })
            .pipe(Effect.mapError((error) => adapterError(context.threadId, "get_state", error)));
          const activeModel = piModelFromState(state);
          const activeThinkingLevel = readString(state, "thinkingLevel");
          if (activeModel) {
            context.activeModel = activeModel;
            updateSession(context, { model: piModelSlug(activeModel) });
          }
          if (activeThinkingLevel) {
            context.activeThinkingLevel = activeThinkingLevel;
          }
        }
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession: (input) => {
        if (input.runtimeMode !== "full-access") {
          return Effect.fail(
            new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue:
                "Pi supports only full-access runtime mode without an owned permission bridge.",
            }),
          );
        }
        return withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            const existing = (yield* Ref.get(sessionsRef)).get(input.threadId);
            if (existing) yield* closeSession(existing);

            const childScope = yield* Scope.make();
            return yield* Effect.gen(function* () {
              const cwd = input.cwd ?? process.cwd();
              const createRuntime = options.makeRuntime ?? makePiRpcRuntime;
              const runtime = yield* createRuntime({
                binaryPath: settings.binaryPath,
                cwd,
                args: buildPiArgs({ settings, start: input }),
                env: buildPiEnvironment(settings, options.environment),
                extendEnv: true,
              }).pipe(
                Effect.provideService(Scope.Scope, childScope),
                Effect.mapError((error) => adapterError(input.threadId, "spawn", error)),
              );

              const state = yield* runtime
                .request<Record<string, unknown>>({ type: "get_state" })
                .pipe(Effect.mapError((error) => adapterError(input.threadId, "get_state", error)));
              const activeModel = piModelFromState(state);
              const activeThinkingLevel = readString(state, "thinkingLevel");
              const sessionModel = activeModel ? piModelSlug(activeModel) : modelSlug(input);
              const createdAt = nowIso();
              const resumeCursor = resumeCursorFromPiState(state, cwd);
              const session = {
                provider: PROVIDER,
                ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                status: "ready",
                runtimeMode: input.runtimeMode,
                cwd,
                ...(sessionModel ? { model: sessionModel } : {}),
                threadId: input.threadId,
                resumeCursor,
                createdAt,
                updatedAt: createdAt,
              } satisfies ProviderSession;
              const context: PiAdapterSessionContext = {
                threadId: input.threadId,
                scope: childScope,
                runtime,
                pendingUiRequests: new Map(),
                assistantMessageCounter: 0,
                assistantTextItemsByContentIndex: new Map(),
                assistantTextByContentIndex: new Map(),
                reasoningItemsByContentIndex: new Map(),
                reasoningTextByContentIndex: new Map(),
                toolCallsByContentIndex: new Map(),
                toolCallStatesByToolCallId: new Map(),
                toolCallItemIdsByToolCallId: new Map(),
                toolOutputByToolCallId: new Map(),
                session,
                ...(activeModel ? { activeModel } : {}),
                ...(activeThinkingLevel ? { activeThinkingLevel } : {}),
                activeTurnStarted: false,
                stopped: false,
              };
              const eventFiber = yield* runtime.events.pipe(
                Stream.runForEach(({ event }) =>
                  logNativeEvent(context, event).pipe(
                    Effect.andThen(
                      Effect.forEach(mapPiEvent(context, event), emitRuntimeEvent, {
                        discard: true,
                      }),
                    ),
                  ),
                ),
                Effect.forkIn(childScope),
              );
              context.eventFiber = eventFiber;
              yield* Ref.update(sessionsRef, (sessions) =>
                new Map(sessions).set(input.threadId, context),
              );
              yield* emitRuntimeEvent({
                eventId: eventId(),
                provider: PROVIDER,
                ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                threadId: input.threadId,
                createdAt: nowIso(),
                type: "session.started",
                payload: { resume: resumeCursor },
              });
              return session;
            }).pipe(Effect.tapError(() => Scope.close(childScope, Exit.void).pipe(Effect.ignore)));
          }),
        );
      },
      sendTurn: (input) =>
        withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            const context = yield* getOpenSessionContext(input.threadId);
            const images = yield* Effect.try({
              try: () => imageInputs(input.attachments, options.serverConfig.attachmentsDir),
              catch: (error) => adapterError(input.threadId, "attachments", error),
            });
            yield* applyPiConfiguration(context, input);
            const isSteering =
              context.activeTurnId !== undefined && context.session.status === "running";
            const activeTurnId = context.activeTurnId ?? turnId();
            const previousSession = context.session;
            const previousActiveTurnId = context.activeTurnId;
            const previousActiveTurnStarted = context.activeTurnStarted;
            const previousTerminalTurnState = context.terminalTurnState;
            const previousTerminalErrorMessage = context.terminalErrorMessage;
            const previousInterruptRequestedTurnId = context.interruptRequestedTurnId;
            if (!isSteering) {
              resetTerminalTurnState(context);
              reserveTurn(context, activeTurnId);
            }
            const command = {
              type: isSteering ? "steer" : "prompt",
              message: input.input ?? "",
              ...(images ? { images } : {}),
            };
            yield* context.runtime.request(command).pipe(
              Effect.mapError((error) =>
                adapterError(input.threadId, isSteering ? "steer" : "prompt", error),
              ),
              Effect.tapError((error) => {
                if (isSteering) return Effect.void;
                context.session = previousSession;
                context.activeTurnId = previousActiveTurnId;
                context.activeTurnStarted = previousActiveTurnStarted;
                context.terminalTurnState = previousTerminalTurnState;
                context.terminalErrorMessage = previousTerminalErrorMessage;
                context.interruptRequestedTurnId = previousInterruptRequestedTurnId;
                return emitRuntimeEvent({
                  eventId: eventId(),
                  provider: PROVIDER,
                  ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                  threadId: input.threadId,
                  turnId: activeTurnId,
                  createdAt: nowIso(),
                  type: "turn.aborted",
                  payload: { reason: error.message },
                });
              }),
            );
            return {
              threadId: input.threadId,
              turnId: activeTurnId,
              resumeCursor: context.session.resumeCursor,
            } satisfies ProviderTurnStartResult;
          }),
        ),
      interruptTurn: (threadId, requestedTurnId) =>
        withThreadLock(
          threadId,
          getOpenSessionContext(threadId).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                const activeTurnId = context.activeTurnId;
                if (requestedTurnId && requestedTurnId !== activeTurnId) return;
                const previousInterruptRequestedTurnId = context.interruptRequestedTurnId;
                if (activeTurnId) context.interruptRequestedTurnId = activeTurnId;
                yield* context.runtime.request({ type: "abort" }).pipe(
                  Effect.asVoid,
                  Effect.mapError((error) => adapterError(threadId, "abort", error)),
                  Effect.tapError(() =>
                    Effect.sync(() => {
                      context.interruptRequestedTurnId = previousInterruptRequestedTurnId;
                    }),
                  ),
                );
                if (!activeTurnId || context.activeTurnId !== activeTurnId) return;
                context.discardNextAgentSettled = true;
                yield* Effect.forEach(
                  settlePiTurn(context, { type: "abort" }, "abort"),
                  emitRuntimeEvent,
                  { discard: true },
                );
              }),
            ),
          ),
        ),
      respondToRequest: (threadId, requestId, decision) =>
        withThreadLock(
          threadId,
          getOpenSessionContext(threadId).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                const pending = context.pendingUiRequests.get(requestId);
                if (!pending || pending.method !== "confirm") {
                  return yield* new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "extension_ui_response",
                    detail: `Unknown pending Pi confirmation request: ${requestId}`,
                  });
                }
                if (decision === "acceptForSession") {
                  return yield* new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "extension_ui_response",
                    detail: "Pi extension confirmations do not support accept-for-session.",
                  });
                }
                yield* context.runtime
                  .notify(
                    decision === "cancel"
                      ? { type: "extension_ui_response", id: requestId, cancelled: true }
                      : {
                          type: "extension_ui_response",
                          id: requestId,
                          confirmed: decision === "accept",
                        },
                  )
                  .pipe(
                    Effect.mapError((error) =>
                      adapterError(threadId, "extension_ui_response", error),
                    ),
                  );
                context.pendingUiRequests.delete(requestId);
                yield* emitRuntimeEvent({
                  ...runtimeEventBase(context, {
                    type: "extension_ui_response",
                    id: requestId,
                  }),
                  requestId: runtimeRequestId(requestId),
                  type: "request.resolved",
                  payload: { requestType: requestTypeForUi(pending.method), decision },
                });
              }),
            ),
          ),
        ),
      respondToUserInput: (threadId, requestId, answers) =>
        withThreadLock(
          threadId,
          getOpenSessionContext(threadId).pipe(
            Effect.flatMap((context) =>
              Effect.gen(function* () {
                const pending = context.pendingUiRequests.get(requestId);
                if (!pending || !isPiUserInputMethod(pending.method)) {
                  return yield* new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "extension_ui_response",
                    detail: `Unknown pending Pi user-input request: ${requestId}`,
                  });
                }
                const value = selectUserInputValue(answers, requestId);
                yield* context.runtime
                  .notify(
                    value === undefined
                      ? { type: "extension_ui_response", id: requestId, cancelled: true }
                      : { type: "extension_ui_response", id: requestId, value },
                  )
                  .pipe(
                    Effect.mapError((error) =>
                      adapterError(threadId, "extension_ui_response", error),
                    ),
                  );
                context.pendingUiRequests.delete(requestId);
                yield* emitRuntimeEvent({
                  ...runtimeEventBase(context, {
                    type: "extension_ui_response",
                    id: requestId,
                  }),
                  requestId: runtimeRequestId(requestId),
                  type: "user-input.resolved",
                  payload: {
                    answers: value === undefined ? {} : { [requestId]: value },
                  },
                });
              }),
            ),
          ),
        ),
      stopSession: (threadId) =>
        withThreadLock(threadId, getSessionContext(threadId).pipe(Effect.flatMap(closeSession))),
      listSessions: () =>
        Ref.get(sessionsRef).pipe(
          Effect.map((sessions) =>
            [...sessions.values()]
              .filter((context) => !context.stopped && context.session.status !== "closed")
              .map((context) => context.session),
          ),
        ),
      hasSession: (threadId) =>
        Ref.get(sessionsRef).pipe(
          Effect.map((sessions) => {
            const context = sessions.get(threadId);
            return context !== undefined && !context.stopped && context.session.status !== "closed";
          }),
        ),
      readThread: (threadId) =>
        getOpenSessionContext(threadId).pipe(
          Effect.flatMap((context) =>
            context.runtime.request<{ entries: unknown[] }>({ type: "get_entries" }),
          ),
          Effect.map(
            (result): ProviderThreadSnapshot => threadSnapshotFromEntries(threadId, result),
          ),
          Effect.mapError((error) => adapterError(threadId, "get_entries", error)),
        ),
      rollbackThread: (threadId, numTurns) => {
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rollbackThread",
              detail: "numTurns must be an integer >= 1.",
            }),
          );
        }
        return withThreadLock(
          threadId,
          getOpenSessionContext(threadId).pipe(
            Effect.flatMap((context) => {
              if (context.activeTurnId || context.session.status === "running") {
                return Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "rollbackThread",
                    detail: "Cannot roll back a running Pi session.",
                  }),
                );
              }
              return context.runtime.request<unknown>({ type: "get_entries" }).pipe(
                Effect.mapError((error) => adapterError(threadId, "get_entries", error)),
                Effect.flatMap((entries) => {
                  const snapshot = readPiEntriesSnapshot(entries);
                  const targetId = snapshot ? rollbackTargetId(snapshot, numTurns) : undefined;
                  if (!targetId) {
                    return Effect.fail(
                      new ProviderAdapterRequestError({
                        provider: PROVIDER,
                        method: "rollbackThread",
                        detail: `Unable to find Pi rollback target for ${numTurns} turn(s).`,
                      }),
                    );
                  }
                  return context.runtime
                    .request<Record<string, unknown>>({ type: "fork", entryId: targetId })
                    .pipe(
                      Effect.mapError((error) => adapterError(threadId, "fork", error)),
                      Effect.flatMap((forkResult) => {
                        if (readBoolean(forkResult, "cancelled") === true) {
                          return Effect.fail(
                            new ProviderAdapterRequestError({
                              provider: PROVIDER,
                              method: "rollbackThread",
                              detail: "Pi rollback fork was cancelled.",
                            }),
                          );
                        }
                        return context.runtime
                          .request<Record<string, unknown>>({ type: "get_state" })
                          .pipe(
                            Effect.mapError((error) =>
                              adapterError(threadId, "get_state after fork", error),
                            ),
                            Effect.flatMap((state) => {
                              const resumeCursor = resumeCursorFromPiState(
                                state,
                                context.session.cwd ?? process.cwd(),
                              );
                              if (!hasPiResumeIdentity(resumeCursor)) {
                                return Effect.fail(
                                  new ProviderAdapterRequestError({
                                    provider: PROVIDER,
                                    method: "get_state after fork",
                                    detail: "Pi fork did not return a resumable session cursor.",
                                  }),
                                );
                              }
                              const activeModel = piModelFromState(state);
                              context.activeModel = activeModel ?? context.activeModel;
                              context.activeThinkingLevel =
                                readString(state, "thinkingLevel") ?? context.activeThinkingLevel;
                              updateSession(context, {
                                resumeCursor,
                                ...(activeModel ? { model: piModelSlug(activeModel) } : {}),
                              });
                              return context.runtime
                                .request<{ entries: unknown[] }>({ type: "get_entries" })
                                .pipe(
                                  Effect.mapError((error) =>
                                    adapterError(threadId, "get_entries after fork", error),
                                  ),
                                );
                            }),
                          );
                      }),
                    );
                }),
                Effect.map(
                  (result): ProviderThreadSnapshot => threadSnapshotFromEntries(threadId, result),
                ),
              );
            }),
          ),
        );
      },
      stopAll: () =>
        Ref.get(sessionsRef).pipe(
          Effect.flatMap((sessions) =>
            Effect.forEach(sessions.values(), closeSession, { discard: true }),
          ),
        ),
      streamEvents: Stream.fromQueue(runtimeEvents),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });

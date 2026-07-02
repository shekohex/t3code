import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ApprovalRequestId,
  PiAgentSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ServerConfig } from "../../config.ts";
import { __PiAdapterTestKit, makePiAdapter } from "./PiAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  PiRpcRuntimeError,
  type PiRpcCommand,
  type PiRpcRawEvent,
  type PiRpcRuntimeShape,
} from "../piRpcRuntime.ts";

const threadId = ThreadId.make("pi-thread-test");
const turnId = TurnId.make("pi-turn-test");
const decodePiSettings = Schema.decodeSync(PiAgentSettings);

type FakeRequestHandler = (command: PiRpcCommand) => Effect.Effect<unknown, PiRpcRuntimeError>;

interface FakePiRuntime {
  readonly runtime: PiRpcRuntimeShape;
  readonly requests: Array<PiRpcCommand>;
  readonly notifications: Array<PiRpcCommand>;
  readonly emit: (event: unknown) => Effect.Effect<void>;
  readonly closeCalls: () => number;
}

function makeFakePiRuntime(
  requestHandler: FakeRequestHandler,
  notifyHandler: (command: PiRpcCommand) => Effect.Effect<void, PiRpcRuntimeError> = () =>
    Effect.void,
): Effect.Effect<FakePiRuntime> {
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<PiRpcRawEvent>();
    const requests: PiRpcCommand[] = [];
    const notifications: PiRpcCommand[] = [];
    let closeCount = 0;
    const runtime: PiRpcRuntimeShape = {
      request: <T>(command: PiRpcCommand) =>
        Effect.sync(() => {
          requests.push(command);
        }).pipe(
          Effect.andThen(requestHandler(command)),
          Effect.map((result) => result as T),
        ),
      notify: (command) =>
        Effect.sync(() => {
          notifications.push(command);
        }).pipe(Effect.andThen(notifyHandler(command))),
      events: Stream.fromQueue(events),
      close: Effect.sync(() => {
        closeCount += 1;
      }),
    };
    return {
      runtime,
      requests,
      notifications,
      emit: (event) => Queue.offer(events, { event }),
      closeCalls: () => closeCount,
    };
  });
}

function makeTestAdapter(
  makeRuntime: () => Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope>,
  options?: { readonly nativeEventLogger?: EventNdjsonLogger | undefined },
) {
  return makePiAdapter(decodePiSettings({ binaryPath: "pi" }), {
    serverConfig: { attachmentsDir: "/tmp/t3-pi-test-attachments" } as ServerConfig["Service"],
    ...(options?.nativeEventLogger ? { nativeEventLogger: options.nativeEventLogger } : {}),
    makeRuntime: () =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const runtime = yield* makeRuntime();
        yield* Scope.addFinalizer(scope, runtime.close);
        return runtime;
      }),
  });
}

function initialState(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: "pi-session-1",
    sessionFile: "/tmp/pi-session-1.jsonl",
    model: { provider: "example", id: "old-model" },
    thinkingLevel: "low",
    ...overrides,
  };
}

function nextRuntimeEvent(adapter: { readonly streamEvents: Stream.Stream<ProviderRuntimeEvent> }) {
  return Stream.runHead(adapter.streamEvents);
}

it("starts one T3 turn for Pi agent lifecycle", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const agentStart = __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  const firstPiTurnStart = __PiAdapterTestKit.mapEvent(context, {
    type: "turn_start",
    turnIndex: 0,
  });
  const secondPiTurnStart = __PiAdapterTestKit.mapEvent(context, {
    type: "turn_start",
    turnIndex: 1,
  });
  const agentEnd = __PiAdapterTestKit.mapEvent(context, { type: "agent_end" });
  const agentSettled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });

  NodeAssert.equal(agentStart[0]?.type, "turn.started");
  NodeAssert.deepEqual(firstPiTurnStart, []);
  NodeAssert.deepEqual(secondPiTurnStart, []);
  NodeAssert.deepEqual(agentEnd, []);
  NodeAssert.equal(agentSettled[0]?.type, "turn.completed");
  NodeAssert.equal(agentSettled[0]?.turnId, agentStart[0]?.turnId);
});

it("emits turn.started when sendTurn already reserved the Pi turn id", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const agentStart = __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  const piTurnStart = __PiAdapterTestKit.mapEvent(context, { type: "turn_start", turnIndex: 0 });

  NodeAssert.equal(agentStart[0]?.type, "turn.started");
  NodeAssert.equal(agentStart[0]?.turnId, turnId);
  NodeAssert.deepEqual(piTurnStart, []);
});

it.effect("rejects Pi runtime modes it cannot enforce", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const result = yield* adapter
        .startSession({
          threadId: ThreadId.make("pi-unsupported-runtime-mode"),
          runtimeMode: "approval-required",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.deepEqual(fake.requests, []);
      if (result._tag === "Failure") NodeAssert.match(result.failure.message, /full-access/i);
    }),
  ),
);

it("does not complete the T3 turn for Pi internal turn_end events", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const agentStart = __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  const piTurnStart = __PiAdapterTestKit.mapEvent(context, { type: "turn_start", turnIndex: 0 });
  const piTurnEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "turn_end",
    turnIndex: 0,
    message: { role: "assistant", content: [{ type: "text", text: "Need tool" }] },
    toolResults: [],
  });
  const nextPiTurnStart = __PiAdapterTestKit.mapEvent(context, {
    type: "turn_start",
    turnIndex: 1,
  });
  const agentEnd = __PiAdapterTestKit.mapEvent(context, { type: "agent_end" });
  const agentSettled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });

  NodeAssert.equal(agentStart[0]?.type, "turn.started");
  NodeAssert.deepEqual(piTurnStart, []);
  NodeAssert.deepEqual(piTurnEnd, []);
  NodeAssert.deepEqual(nextPiTurnStart, []);
  NodeAssert.deepEqual(agentEnd, []);
  NodeAssert.equal(agentSettled[0]?.type, "turn.completed");
  NodeAssert.equal(agentSettled[0]?.turnId, agentStart[0]?.turnId);
});

it("keeps streamed Pi assistant deltas on one assistant item", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const messageStart = __PiAdapterTestKit.mapEvent(context, {
    type: "message_start",
    message: { role: "assistant", id: "message-1", content: [] },
  });
  const start = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-1", content: [] },
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  });
  const firstDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-1", content: [] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
  });
  const secondDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-1", content: [] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo" },
  });
  const blockEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-1", content: [] },
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hello" },
  });
  const nextBlockDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-1", content: [] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: " world" },
  });
  const messageEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "message_end",
    message: { role: "assistant", id: "message-1", content: [] },
  });

  NodeAssert.equal(messageStart[0]?.type, "item.started");
  NodeAssert.deepEqual(start, []);
  NodeAssert.equal(firstDelta[0]?.type, "content.delta");
  NodeAssert.equal(secondDelta[0]?.type, "content.delta");
  NodeAssert.deepEqual(blockEnd, []);
  NodeAssert.equal(nextBlockDelta[0]?.type, "content.delta");
  NodeAssert.equal(messageEnd[0]?.type, "item.completed");
  NodeAssert.equal(firstDelta[0]?.itemId, messageStart[0]?.itemId);
  NodeAssert.equal(secondDelta[0]?.itemId, messageStart[0]?.itemId);
  NodeAssert.equal(nextBlockDelta[0]?.itemId, messageStart[0]?.itemId);
  NodeAssert.equal(messageEnd[0]?.itemId, messageStart[0]?.itemId);
  NodeAssert.deepEqual(
    [firstDelta[0], secondDelta[0], nextBlockDelta[0]].map((event) =>
      event?.type === "content.delta" ? event.payload.streamKind : undefined,
    ),
    ["assistant_text", "assistant_text", "assistant_text"],
  );
});

it("uses Pi cumulative partial text to keep assistant markdown complete", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  __PiAdapterTestKit.mapEvent(context, {
    type: "message_start",
    message: { role: "assistant", id: "message-partial", content: [] },
  });
  const firstDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-partial", content: [] },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 1,
      delta: "-",
      partial: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Plan" },
          { type: "text", text: "- item" },
        ],
      },
    },
  });
  const secondDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    message: { role: "assistant", id: "message-partial", content: [] },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 1,
      delta: "m",
      partial: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Plan" },
          { type: "text", text: "- item\n- more" },
        ],
      },
    },
  });

  const assistantDeltas = [...firstDelta, ...secondDelta].filter(
    (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
  );
  NodeAssert.deepEqual(
    assistantDeltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
    ["- item", "\n- more"],
  );
});

it("projects Pi cumulative thinking snapshots as reasoning deltas", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const events = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 1,
      delta: "H",
      partial: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Think" },
          { type: "text", text: "Hi" },
        ],
      },
    },
  });

  const reasoningDelta = events.find(
    (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
  );

  NodeAssert.equal(reasoningDelta?.type, "content.delta");
  NodeAssert.equal(
    reasoningDelta?.type === "content.delta" ? reasoningDelta.payload.delta : undefined,
    "Think",
  );
  NodeAssert.ok(events.every((event) => event.type !== "task.progress"));
});

it("does not duplicate Pi thinking_delta when partial snapshot carries the same thinking", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const first = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta: "Think",
      partial: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Think" }],
      },
    },
  });
  const second = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta: " more",
      partial: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Think more" }],
      },
    },
  });

  const reasoningDeltas = [...first, ...second].filter(
    (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
  );
  NodeAssert.deepEqual(
    reasoningDeltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
    ["Think", " more"],
  );
});

it("ignores non-interactive Pi UI status requests", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const events = __PiAdapterTestKit.mapEvent(context, {
    type: "extension_ui_request",
    id: "status-1",
    method: "setTitle",
    title: "π - agent",
  });

  NodeAssert.deepEqual(events, []);
});

it("maps Pi tool-call JSON deltas to tool lifecycle, not assistant text", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const toolStart = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      toolCall: { id: "call-1", name: "bash" },
    },
  });
  const toolDelta = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 1,
      delta: '{"command":"vp check","description":"Runs quality checks"}',
    },
  });
  const executionUpdate = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    partialResult: { output: "check output" },
  });

  NodeAssert.equal(toolStart[0]?.type, "item.started");
  NodeAssert.equal(toolDelta[0]?.type, "item.updated");
  NodeAssert.equal(toolDelta[0]?.itemId, toolStart[0]?.itemId);
  NodeAssert.ok(toolDelta.every((event) => event.type !== "content.delta"));

  const payload = toolDelta[0]?.payload;
  NodeAssert.equal(payload?.itemType, "command_execution");
  NodeAssert.equal(payload?.detail, "Runs quality checks");
  NodeAssert.deepEqual(payload?.data, {
    toolCallId: "call-1",
    toolName: "bash",
    command: "vp check",
    input: { command: "vp check", description: "Runs quality checks" },
  });

  const executionUpdateLifecycle = executionUpdate[0];
  NodeAssert.ok(executionUpdateLifecycle?.type === "item.updated");
  NodeAssert.equal(executionUpdateLifecycle.itemId, toolStart[0]?.itemId);
  NodeAssert.equal(executionUpdateLifecycle.payload.detail, "Runs quality checks");
  NodeAssert.deepEqual(executionUpdateLifecycle.payload.data, {
    toolCallId: "call-1",
    toolName: "bash",
    command: "vp check",
    input: { command: "vp check", description: "Runs quality checks" },
    partialResult: { output: "check output" },
    outputText: "check output",
  });
  NodeAssert.equal(executionUpdate[1]?.type, "content.delta");
  NodeAssert.equal(
    executionUpdate[1]?.type === "content.delta" ? executionUpdate[1].payload.streamKind : null,
    "command_output",
  );
});

it("keeps Pi tool result content in structured payload", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const toolEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_end",
    toolCallId: "call-read",
    toolName: "read",
    result: { content: [{ type: "text", text: "file contents" }] },
    isError: false,
  });

  const completed = toolEnd[0];
  NodeAssert.equal(completed?.type, "item.completed");
  NodeAssert.deepEqual(completed?.payload.data, {
    toolCallId: "call-read",
    toolName: "read",
    result: { content: [{ type: "text", text: "file contents" }] },
    outputText: "file contents",
    isError: false,
  });
});

it("maps Pi queue updates to session state details", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const events = __PiAdapterTestKit.mapEvent(context, {
    type: "queue_update",
    steering: ["interrupt"],
    followUp: ["next"],
  });

  const event = events[0];
  NodeAssert.equal(event?.type, "session.state.changed");
  NodeAssert.deepEqual(event?.type === "session.state.changed" ? event.payload : undefined, {
    state: "waiting",
    reason: "queue_update",
    detail: { steeringCount: 1, followUpCount: 1 },
  });
});

it("maps Pi compaction lifecycle to context compaction item events", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const started = __PiAdapterTestKit.mapEvent(context, {
    type: "compaction_start",
    reason: "threshold",
  });
  const completed = __PiAdapterTestKit.mapEvent(context, {
    type: "compaction_end",
    reason: "threshold",
    result: { tokensBefore: 1000, tokensAfter: 200 },
    aborted: false,
    willRetry: false,
  });

  NodeAssert.equal(started[0]?.type, "item.started");
  NodeAssert.equal(completed[0]?.type, "item.completed");
  NodeAssert.equal(completed[0]?.itemId, started[0]?.itemId);
  NodeAssert.deepEqual(started[0]?.payload, {
    itemType: "context_compaction",
    status: "inProgress",
    title: "Context compaction",
    detail: "threshold",
    data: { reason: "threshold" },
  });
  NodeAssert.deepEqual(completed[0]?.payload, {
    itemType: "context_compaction",
    status: "completed",
    title: "Context compaction",
    detail: "threshold",
    data: {
      reason: "threshold",
      result: { tokensBefore: 1000, tokensAfter: 200 },
      aborted: false,
      willRetry: false,
    },
  });
});

it("maps Pi retry lifecycle to task events", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const started = __PiAdapterTestKit.mapEvent(context, {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 1500,
    errorMessage: "rate limited",
  });
  const completed = __PiAdapterTestKit.mapEvent(context, {
    type: "auto_retry_end",
    attempt: 1,
    success: true,
  });

  NodeAssert.deepEqual(
    started.map((event) => event.type),
    ["task.started", "task.progress"],
  );
  NodeAssert.equal(completed[0]?.type, "task.completed");
  NodeAssert.equal(
    completed[0]?.type === "task.completed" ? completed[0].payload.status : undefined,
    "completed",
  );
  NodeAssert.equal(
    completed[0]?.type === "task.completed" ? completed[0].payload.taskId : undefined,
    started[0]?.type === "task.started" ? started[0].payload.taskId : undefined,
  );
});

it("maps structured Pi subagent status messages to task completion events", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const completed = __PiAdapterTestKit.mapEvent(context, {
    type: "message_end",
    message: {
      role: "custom",
      customType: "subagent-status",
      display: true,
      content: "Subagent reviewer (child-completed) completed.",
      details: {
        sessionId: "child-completed",
        name: "reviewer",
        status: "completed",
        summary: "No regressions found.",
      },
    },
  });
  const failed = __PiAdapterTestKit.mapEvent(context, {
    type: "message_end",
    message: {
      role: "custom",
      customType: "subagent-status",
      display: true,
      content: "Subagent verifier (child-failed) failed.",
      details: {
        sessionId: "child-failed",
        name: "verifier",
        status: "failed",
        summary: "Validation failed.",
      },
    },
  });
  const cancelled = __PiAdapterTestKit.mapEvent(context, {
    type: "message_end",
    message: {
      role: "custom",
      customType: "subagent-status",
      display: true,
      content: "Subagent mapper (child-cancelled) was cancelled.",
      details: {
        sessionId: "child-cancelled",
        name: "mapper",
        status: "cancelled",
      },
    },
  });

  NodeAssert.deepEqual(completed[0]?.type === "task.completed" ? completed[0].payload : undefined, {
    taskId: "pi-subagent:child-completed",
    status: "completed",
    summary: "reviewer: No regressions found.",
  });
  NodeAssert.deepEqual(failed[0]?.type === "task.completed" ? failed[0].payload : undefined, {
    taskId: "pi-subagent:child-failed",
    status: "failed",
    summary: "verifier: Validation failed.",
  });
  NodeAssert.deepEqual(cancelled[0]?.type === "task.completed" ? cancelled[0].payload : undefined, {
    taskId: "pi-subagent:child-cancelled",
    status: "stopped",
    summary: "mapper: cancelled.",
  });
});

it("ignores hidden, malformed, and unrecognized Pi custom messages", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });
  const messages = [
    {
      role: "custom",
      customType: "subagent-status",
      display: false,
      content: "Hidden status",
      details: { sessionId: "child-hidden", name: "hidden", status: "completed" },
    },
    {
      role: "custom",
      customType: "subagent-status",
      display: true,
      content: "Malformed status",
      details: { sessionId: "child-malformed", name: "malformed", status: "running" },
    },
    {
      role: "custom",
      customType: "extension-private",
      display: true,
      content: "Other custom message",
      details: { sessionId: "child-other", name: "other", status: "completed" },
    },
  ];

  for (const message of messages) {
    NodeAssert.deepEqual(
      __PiAdapterTestKit.mapEvent(context, { type: "message_end", message }),
      [],
    );
  }
});

it("maps Pi session metadata and thinking changes", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  const metadata = __PiAdapterTestKit.mapEvent(context, {
    type: "session_info_changed",
    name: "Fix Pi RPC",
  });
  const thinking = __PiAdapterTestKit.mapEvent(context, {
    type: "thinking_level_changed",
    level: "high",
  });

  NodeAssert.equal(metadata[0]?.type, "thread.metadata.updated");
  NodeAssert.deepEqual(metadata[0]?.payload, {
    name: "Fix Pi RPC",
    metadata: { sessionName: "Fix Pi RPC" },
  });
  NodeAssert.equal(thinking[0]?.type, "session.configured");
  NodeAssert.deepEqual(thinking[0]?.payload, { config: { thinkingLevel: "high" } });
});

it("waits for agent_settled after a retried Pi model error", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "error",
      reason: "error",
      error: { errorMessage: "rate limited" },
    },
  });
  const agentEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "agent_end",
    willRetry: true,
  });
  __PiAdapterTestKit.mapEvent(context, {
    type: "auto_retry_end",
    attempt: 1,
    success: true,
  });
  const settled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });

  NodeAssert.deepEqual(agentEnd, []);
  const completed = settled.find((event) => event.type === "turn.completed");
  NodeAssert.equal(completed?.type, "turn.completed");
  NodeAssert.equal(
    completed?.type === "turn.completed" ? completed.payload.state : undefined,
    "completed",
  );
});

it("reports final Pi retry failures only when settled", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  __PiAdapterTestKit.mapEvent(context, {
    type: "auto_retry_end",
    attempt: 3,
    success: false,
    finalError: "overloaded",
  });
  const settled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });
  const completed = settled.find((event) => event.type === "turn.completed");

  NodeAssert.equal(completed?.type, "turn.completed");
  NodeAssert.deepEqual(completed?.type === "turn.completed" ? completed.payload : undefined, {
    state: "failed",
    errorMessage: "overloaded",
  });
  NodeAssert.ok(
    settled.some(
      (event) => event.type === "runtime.error" && event.payload.message === "overloaded",
    ),
  );
});

it("maps Pi aborted model streams to interrupted turns at settlement", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "error",
      reason: "aborted",
      error: { errorMessage: "cancelled by user" },
    },
  });
  const settled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });
  const completed = settled.find((event) => event.type === "turn.completed");

  NodeAssert.equal(completed?.type, "turn.completed");
  NodeAssert.deepEqual(completed?.type === "turn.completed" ? completed.payload : undefined, {
    state: "interrupted",
    errorMessage: "cancelled by user",
  });
});

it("completes a started Pi assistant item when its stream errors before text", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const started = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: { type: "text_start", contentIndex: 0 },
  });
  const errored = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "error",
      reason: "error",
      error: { errorMessage: "rate limited" },
    },
  });

  NodeAssert.equal(started[0]?.type, "item.started");
  NodeAssert.equal(errored[0]?.type, "item.completed");
  NodeAssert.equal(errored[0]?.itemId, started[0]?.itemId);
});

it("clears an interrupted Pi terminal state after a successful retry", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId });

  __PiAdapterTestKit.mapEvent(context, { type: "agent_start" });
  __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "error",
      reason: "aborted",
      error: { errorMessage: "cancelled" },
    },
  });
  __PiAdapterTestKit.mapEvent(context, { type: "auto_retry_end", attempt: 1, success: true });
  const settled = __PiAdapterTestKit.mapEvent(context, { type: "agent_settled" });
  const completed = settled.find((event) => event.type === "turn.completed");

  NodeAssert.equal(completed?.type, "turn.completed");
  NodeAssert.equal(
    completed?.type === "turn.completed" ? completed.payload.state : undefined,
    "completed",
  );
});

it("classifies nonzero Pi process exits as errors and fails active turns", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const events = __PiAdapterTestKit.mapEvent(context, {
    type: "process_exit",
    code: 17,
    signal: null,
  });
  const completed = events.find((event) => event.type === "turn.completed");
  const exited = events.find((event) => event.type === "session.exited");

  NodeAssert.equal(completed?.type, "turn.completed");
  NodeAssert.equal(
    completed?.type === "turn.completed" ? completed.payload.state : undefined,
    "failed",
  );
  NodeAssert.equal(exited?.type, "session.exited");
  NodeAssert.equal(
    exited?.type === "session.exited" ? exited.payload.exitKind : undefined,
    "error",
  );

  const signalContext = __PiAdapterTestKit.makeContext({ threadId });
  const signalExit = __PiAdapterTestKit
    .mapEvent(signalContext, { type: "process_exit", code: null, signal: "SIGTERM" })
    .find((event) => event.type === "session.exited");
  NodeAssert.equal(
    signalExit?.type === "session.exited" ? signalExit.payload.exitKind : undefined,
    "error",
  );
});

it.effect("restores a fresh session after Pi prompt rejection and emits turn.aborted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let promptAttempts = 0;
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") return Effect.succeed(initialState());
        if (command.type === "prompt") {
          promptAttempts += 1;
          return promptAttempts === 1
            ? Effect.fail(new PiRpcRuntimeError({ detail: "prompt rejected" }))
            : Effect.succeed({});
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-prompt-failure");

      yield* adapter.startSession({
        threadId: testThreadId,
        provider: ProviderDriverKind.make("piAgent"),
        runtimeMode: "full-access",
      });
      yield* nextRuntimeEvent(adapter);
      const result = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "fail", attachments: [] })
        .pipe(Effect.result);
      const aborted = yield* nextRuntimeEvent(adapter);
      const sessionAfterFailure = (yield* adapter.listSessions())[0];
      const recovered = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "retry",
        attachments: [],
      });
      const sessions = yield* adapter.listSessions();

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(sessionAfterFailure?.status, "ready");
      NodeAssert.equal(sessionAfterFailure?.activeTurnId, undefined);
      NodeAssert.equal(aborted._tag, "Some");
      if (aborted._tag === "Some") {
        NodeAssert.equal(aborted.value.type, "turn.aborted");
      }
      NodeAssert.equal(promptAttempts, 2);
      NodeAssert.equal(recovered.threadId, testThreadId);
      NodeAssert.equal(sessions[0]?.status, "running");
    }),
  ),
);

it.effect("preserves a running Pi predecessor when steering fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let steerAttempts = 0;
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") return Effect.succeed(initialState());
        if (command.type === "steer") {
          steerAttempts += 1;
          return Effect.fail(new PiRpcRuntimeError({ detail: "steer rejected" }));
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-steer-failure");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* adapter.sendTurn({ threadId: testThreadId, input: "first", attachments: [] });
      const beforeFailure = (yield* adapter.listSessions())[0];
      const result = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "steer", attachments: [] })
        .pipe(Effect.result);
      const afterFailure = (yield* adapter.listSessions())[0];

      NodeAssert.equal(steerAttempts, 1);
      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(afterFailure?.status, "running");
      NodeAssert.equal(afterFailure?.activeTurnId, beforeFailure?.activeTurnId);
    }),
  ),
);

it.effect("marks an explicitly interrupted Pi turn as interrupted when it settles", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-explicit-interrupt");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      const turn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "interrupt me",
        attachments: [],
      });
      yield* adapter.interruptTurn(testThreadId, turn.turnId);
      yield* fake.emit({ type: "agent_settled" });
      const completed = yield* nextRuntimeEvent(adapter);

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "prompt", "abort"],
      );
      NodeAssert.equal(completed._tag, "Some");
      if (completed._tag === "Some") {
        NodeAssert.equal(completed.value.type, "turn.completed");
        if (completed.value.type === "turn.completed") {
          NodeAssert.equal(completed.value.payload.state, "interrupted");
        }
      }
    }),
  ),
);

it.effect("settles an interrupted Pi turn when abort succeeds", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-interrupt-settlement");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      const turn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "interrupt me",
        attachments: [],
      });
      const turnCompleted = yield* Deferred.make<ProviderRuntimeEvent>();
      const sessionReady = yield* Deferred.make<ProviderRuntimeEvent>();
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.gen(function* () {
          if (event.type === "turn.completed") {
            yield* Deferred.succeed(turnCompleted, event).pipe(Effect.ignore);
          }
          if (event.type === "session.state.changed" && event.payload.state === "ready") {
            yield* Deferred.succeed(sessionReady, event).pipe(Effect.ignore);
          }
        }),
      ).pipe(Effect.forkChild);
      yield* adapter.interruptTurn(testThreadId, turn.turnId);

      const session = (yield* adapter.listSessions())[0];
      NodeAssert.equal(session?.status, "ready");
      NodeAssert.equal(session?.activeTurnId, undefined);

      const completed = yield* Deferred.await(turnCompleted);
      const ready = yield* Deferred.await(sessionReady);
      yield* Fiber.interrupt(runtimeEventsFiber);

      NodeAssert.equal(completed.type, "turn.completed");
      if (completed.type === "turn.completed") {
        NodeAssert.equal(completed.turnId, turn.turnId);
        NodeAssert.equal(completed.payload.state, "interrupted");
      }
      NodeAssert.equal(ready.type, "session.state.changed");
      if (ready.type === "session.state.changed") {
        NodeAssert.deepEqual(ready.payload, { state: "ready", reason: "abort" });
      }
    }),
  ),
);

it.effect("ignores a late Pi settlement after interrupting a prior turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-late-interrupt-settlement");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      const interruptedTurn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "interrupt me",
        attachments: [],
      });
      yield* adapter.interruptTurn(testThreadId, interruptedTurn.turnId);

      const nextTurn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "continue",
        attachments: [],
      });
      yield* fake.emit({ type: "agent_settled" });
      for (let yieldAttempt = 0; yieldAttempt < 8; yieldAttempt += 1) {
        yield* Effect.yieldNow;
      }

      const session = (yield* adapter.listSessions())[0];
      NodeAssert.equal(session?.status, "running");
      NodeAssert.equal(session?.activeTurnId, nextTurn.turnId);
    }),
  ),
);

it.effect("settles the next Pi turn when no late settlement arrives", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-next-turn-after-interrupt");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      const interruptedTurn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "interrupt me",
        attachments: [],
      });
      yield* adapter.interruptTurn(testThreadId, interruptedTurn.turnId);

      const nextTurn = yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "continue",
        attachments: [],
      });
      yield* fake.emit({ type: "agent_start" });
      yield* fake.emit({ type: "agent_settled" });
      for (let yieldAttempt = 0; yieldAttempt < 8; yieldAttempt += 1) {
        yield* Effect.yieldNow;
      }

      const session = (yield* adapter.listSessions())[0];
      NodeAssert.equal(session?.status, "ready");
      NodeAssert.equal(session?.activeTurnId, undefined);
      NodeAssert.notEqual(nextTurn.turnId, interruptedTurn.turnId);
    }),
  ),
);

it.effect("uses public Pi model and thinking commands before a turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let state = initialState();
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") return Effect.succeed(state);
        if (command.type === "set_model") {
          state = {
            ...state,
            model: { provider: command.provider, id: command.modelId },
          };
          return Effect.succeed({ provider: command.provider, id: command.modelId });
        }
        if (command.type === "set_thinking_level") {
          state = { ...state, thinkingLevel: command.level };
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-model-thinking");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "configure",
        attachments: [],
        modelSelection: {
          instanceId: ProviderInstanceId.make("piAgent"),
          model: "example/new-model",
          options: [{ id: "thinking", value: "high" }],
        },
      });
      const session = (yield* adapter.listSessions())[0];

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "set_model", "set_thinking_level", "get_state", "prompt"],
      );
      NodeAssert.deepEqual(fake.requests[1], {
        type: "set_model",
        provider: "example",
        modelId: "new-model",
      });
      NodeAssert.deepEqual(fake.requests[2], { type: "set_thinking_level", level: "high" });
      NodeAssert.equal(session?.model, "example/new-model");
    }),
  ),
);

it.effect("does not update Pi session model when set_model fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") return Effect.succeed(initialState());
        if (command.type === "set_model") {
          return Effect.fail(new PiRpcRuntimeError({ detail: "unknown model" }));
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-model-failure");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const result = yield* adapter
        .sendTurn({
          threadId: testThreadId,
          input: "configure",
          attachments: [],
          modelSelection: {
            instanceId: ProviderInstanceId.make("piAgent"),
            model: "example/missing-model",
          },
        })
        .pipe(Effect.result);
      const session = (yield* adapter.listSessions())[0];

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(session?.model, "example/old-model");
      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "set_model"],
      );
    }),
  ),
);

it.effect("rejects Pi model selections without a provider/model slug", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-invalid-model-slug");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const result = yield* adapter
        .sendTurn({
          threadId: testThreadId,
          input: "configure",
          attachments: [],
          modelSelection: {
            instanceId: ProviderInstanceId.make("piAgent"),
            model: "missing-provider",
          },
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state"],
      );
      if (result._tag === "Failure") NodeAssert.match(result.failure.message, /provider\/model/);
    }),
  ),
);

it.effect("resolves Pi extension input only after its public UI response is accepted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let failResponse = true;
      const fake = yield* makeFakePiRuntime(
        (command) =>
          command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
        () =>
          failResponse
            ? Effect.fail(new PiRpcRuntimeError({ detail: "stdin unavailable" }))
            : Effect.void,
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-ui-input");
      const requestId = ApprovalRequestId.make("input-1");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: "input-1",
        method: "select",
        title: "Choose scope",
        options: ["Workspace", "Project"],
      });
      const requested = yield* nextRuntimeEvent(adapter);
      const firstResponse = yield* adapter
        .respondToUserInput(testThreadId, requestId, { "input-1": "Workspace" })
        .pipe(Effect.result);

      NodeAssert.equal(requested._tag, "Some");
      if (requested._tag === "Some") {
        NodeAssert.equal(requested.value.type, "user-input.requested");
      }
      NodeAssert.equal(firstResponse._tag, "Failure");

      failResponse = false;
      yield* adapter.respondToUserInput(testThreadId, requestId, {
        "input-1": "Workspace",
      });
      const resolved = yield* nextRuntimeEvent(adapter);
      const staleResponse = yield* adapter
        .respondToUserInput(testThreadId, requestId, { "input-1": "Project" })
        .pipe(Effect.result);

      NodeAssert.deepEqual(fake.notifications, [
        { type: "extension_ui_response", id: "input-1", value: "Workspace" },
        { type: "extension_ui_response", id: "input-1", value: "Workspace" },
      ]);
      NodeAssert.equal(resolved._tag, "Some");
      if (resolved._tag === "Some") {
        NodeAssert.equal(resolved.value.type, "user-input.resolved");
        if (resolved.value.type === "user-input.resolved") {
          NodeAssert.deepEqual(resolved.value.payload.answers, { "input-1": "Workspace" });
        }
      }
      NodeAssert.equal(staleResponse._tag, "Failure");
    }),
  ),
);

it.effect("rejects Pi accept-for-session confirmations without claiming native scope support", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-ui-confirm");
      const requestId = ApprovalRequestId.make("confirm-1");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: "confirm-1",
        method: "confirm",
        title: "Continue?",
      });
      const requested = yield* nextRuntimeEvent(adapter);
      const unsupported = yield* adapter
        .respondToRequest(testThreadId, requestId, "acceptForSession")
        .pipe(Effect.result);

      NodeAssert.equal(requested._tag, "Some");
      if (requested._tag === "Some") NodeAssert.equal(requested.value.type, "request.opened");
      NodeAssert.equal(unsupported._tag, "Failure");
      NodeAssert.deepEqual(fake.notifications, []);

      yield* adapter.respondToRequest(testThreadId, requestId, "accept");
      const resolved = yield* nextRuntimeEvent(adapter);
      NodeAssert.deepEqual(fake.notifications, [
        { type: "extension_ui_response", id: "confirm-1", confirmed: true },
      ]);
      NodeAssert.equal(resolved._tag, "Some");
      if (resolved._tag === "Some") NodeAssert.equal(resolved.value.type, "request.resolved");
    }),
  ),
);

it.effect("keeps Pi session ready when an attachment cannot be loaded", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-attachment-failure");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const result = yield* adapter
        .sendTurn({
          threadId: testThreadId,
          input: "read image",
          attachments: [
            {
              type: "image",
              id: "pi-00000000-0000-0000-0000-000000000000",
              name: "missing.png",
              mimeType: "image/png",
              sizeBytes: 1,
            },
          ],
        })
        .pipe(Effect.result);
      const session = (yield* adapter.listSessions())[0];

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(session?.status, "ready");
      NodeAssert.equal(session?.activeTurnId, undefined);
      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state"],
      );
    }),
  ),
);

it.effect("replaces same-thread Pi sessions without leaking the predecessor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstRuntime = yield* makeFakePiRuntime((command) =>
        command.type === "get_state"
          ? Effect.succeed(initialState({ sessionId: "first" }))
          : Effect.succeed({}),
      );
      const secondRuntime = yield* makeFakePiRuntime((command) =>
        command.type === "get_state"
          ? Effect.succeed(initialState({ sessionId: "second" }))
          : Effect.succeed({}),
      );
      const runtimes = [firstRuntime, secondRuntime];
      let runtimeIndex = 0;
      const adapter = yield* makeTestAdapter(
        (): Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope> => {
          const runtime = runtimes[runtimeIndex++];
          if (!runtime) return Effect.fail(new PiRpcRuntimeError({ detail: "unexpected runtime" }));
          return Effect.succeed(runtime.runtime);
        },
      );
      const testThreadId = ThreadId.make("pi-replacement");

      const firstStart = yield* adapter
        .startSession({ threadId: testThreadId, runtimeMode: "full-access" })
        .pipe(Effect.forkChild);
      const secondStart = yield* adapter
        .startSession({ threadId: testThreadId, runtimeMode: "full-access" })
        .pipe(Effect.forkChild);
      yield* Fiber.join(firstStart);
      yield* Fiber.join(secondStart);
      const sessions = yield* adapter.listSessions();

      NodeAssert.equal(firstRuntime.closeCalls(), 1);
      NodeAssert.equal(secondRuntime.closeCalls(), 0);
      NodeAssert.equal(sessions.length, 1);
      NodeAssert.deepEqual(sessions[0]?.resumeCursor, {
        version: 1,
        sessionFile: "/tmp/pi-session-1.jsonl",
        sessionId: "second",
        cwd: process.cwd(),
      });
    }),
  ),
);

it.effect("rolls back with public get_entries and fork while refreshing resume cursor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let forked = false;
      const originalEntries = {
        leafId: "assistant-2",
        entries: [
          { id: "user-1", parentId: null, type: "message", message: { role: "user" } },
          {
            id: "assistant-1",
            parentId: "user-1",
            type: "message",
            message: { role: "assistant" },
          },
          {
            id: "user-2",
            parentId: "assistant-1",
            type: "message",
            message: { role: "user" },
          },
          {
            id: "assistant-2",
            parentId: "user-2",
            type: "message",
            message: { role: "assistant" },
          },
        ],
      };
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") {
          return Effect.succeed(
            initialState(
              forked
                ? { sessionId: "forked-session", sessionFile: "/tmp/forked-session.jsonl" }
                : {},
            ),
          );
        }
        if (command.type === "get_entries") {
          return Effect.succeed(
            forked
              ? {
                  ...originalEntries,
                  leafId: "assistant-1",
                  entries: originalEntries.entries.slice(0, 2),
                }
              : originalEntries,
          );
        }
        if (command.type === "fork") {
          forked = true;
          return Effect.succeed({ cancelled: false });
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-public-rollback");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const snapshot = yield* adapter.rollbackThread(testThreadId, 1);
      const session = (yield* adapter.listSessions())[0];

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "get_entries", "fork", "get_state", "get_entries"],
      );
      NodeAssert.deepEqual(fake.requests[2], { type: "fork", entryId: "user-2" });
      NodeAssert.equal(snapshot.threadId, testThreadId);
      NodeAssert.equal(snapshot.turns[0]?.items.length, 2);
      NodeAssert.equal(session?.threadId, testThreadId);
      NodeAssert.deepEqual(session?.resumeCursor, {
        version: 1,
        sessionFile: "/tmp/forked-session.jsonl",
        sessionId: "forked-session",
        cwd: process.cwd(),
      });
    }),
  ),
);

it.effect("serializes concurrent Pi sends before deciding prompt versus steer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstPromptReceived = yield* Deferred.make<void>();
      const releaseFirstPrompt = yield* Deferred.make<void>();
      let promptAttempts = 0;
      const fake = yield* makeFakePiRuntime((command) => {
        if (command.type === "get_state") return Effect.succeed(initialState());
        if (command.type === "prompt") {
          promptAttempts += 1;
          if (promptAttempts === 1) {
            return Deferred.succeed(firstPromptReceived, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirstPrompt)),
              Effect.as({}),
            );
          }
        }
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-send-serialization");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const first = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "first", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Deferred.await(firstPromptReceived);
      const second = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "second", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "prompt"],
      );

      yield* Deferred.succeed(releaseFirstPrompt, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "prompt", "steer"],
      );
    }),
  ),
);

it.effect("removes exited Pi sessions from active session routing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-process-exit");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({ type: "process_exit", code: 17, signal: null });
      yield* nextRuntimeEvent(adapter);

      NodeAssert.equal(yield* adapter.hasSession(testThreadId), false);
      NodeAssert.deepEqual(yield* adapter.listSessions(), []);
    }),
  ),
);

it.effect("writes raw Pi RPC events without delaying canonical mapping", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const nativeEvents: unknown[] = [];
      const nativeEventLogger: EventNdjsonLogger = {
        filePath: "memory://pi-native-events",
        write: (event) =>
          Effect.sync(() => {
            nativeEvents.push(event);
          }),
        close: () => Effect.void,
      };
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime), {
        nativeEventLogger,
      });
      const testThreadId = ThreadId.make("pi-native-events");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({ type: "agent_start" });
      const started = yield* nextRuntimeEvent(adapter);

      NodeAssert.equal(started._tag, "Some");
      NodeAssert.equal(nativeEvents.length, 1);
      const logged = nativeEvents[0] as {
        readonly event: {
          readonly method: string;
          readonly threadId: ThreadId;
          readonly payload: unknown;
        };
      };
      NodeAssert.equal(logged.event.method, "agent_start");
      NodeAssert.equal(logged.event.threadId, testThreadId);
      NodeAssert.deepEqual(logged.event.payload, { type: "agent_start" });
    }),
  ),
);

it.effect("keeps Pi event mapping alive when native logging fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const nativeEventLogger: EventNdjsonLogger = {
        filePath: "memory://pi-native-event-failure",
        write: () => Effect.die("native log unavailable"),
        close: () => Effect.void,
      };
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime), {
        nativeEventLogger,
      });
      const testThreadId = ThreadId.make("pi-native-event-failure");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({ type: "agent_start" });
      const started = yield* nextRuntimeEvent(adapter);

      NodeAssert.equal(started._tag, "Some");
      if (started._tag === "Some") NodeAssert.equal(started.value.type, "turn.started");
    }),
  ),
);

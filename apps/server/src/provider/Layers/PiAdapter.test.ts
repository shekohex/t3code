// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
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
import * as TestClock from "effect/testing/TestClock";

import type { ServerConfig } from "../../config.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { __PiAdapterTestKit, makePiAdapter } from "./PiAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  PiRpcRuntimeError,
  type PiRpcCommand,
  type PiRpcRawEvent,
  type PiRpcRuntimeOptions,
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
  readonly end: Effect.Effect<void>;
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
      end: Queue.shutdown(events),
      closeCalls: () => closeCount,
    };
  });
}

function makeTestAdapter(
  makeRuntime: () => Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope>,
  options?: {
    readonly attachmentsDir?: string | undefined;
    readonly nativeEventLogger?: EventNdjsonLogger | undefined;
    readonly onRuntimeOptions?: ((options: PiRpcRuntimeOptions) => void) | undefined;
    readonly settings?: Partial<PiAgentSettings> | undefined;
  },
) {
  return makePiAdapter(decodePiSettings({ binaryPath: "pi", ...options?.settings }), {
    serverConfig: {
      attachmentsDir: options?.attachmentsDir ?? "/tmp/t3-pi-test-attachments",
    } as ServerConfig["Service"],
    ...(options?.nativeEventLogger ? { nativeEventLogger: options.nativeEventLogger } : {}),
    makeRuntime: (runtimeOptions) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        options?.onRuntimeOptions?.(runtimeOptions);
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

it.effect("adds validated Pi mode flags after static launch args", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtimeOptions: PiRpcRuntimeOptions[] = [];
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime), {
        settings: { launchArgs: "--static launch" },
        onRuntimeOptions: (options) => runtimeOptions.push(options),
      });

      yield* adapter.startSession({
        threadId: ThreadId.make("pi-mode-flags"),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: ProviderInstanceId.make("piAgent"),
          model: "example/new-model",
          options: [{ id: "piModeFlags", value: "--mode-safe --mode-debug" }],
        },
      });

      NodeAssert.deepEqual(runtimeOptions[0]?.args, [
        "--mode",
        "rpc",
        "--model",
        "example/new-model",
        "--static",
        "launch",
        "--mode-safe",
        "--mode-debug",
      ]);
    }),
  ),
);

it.effect("rejects invalid Pi mode flags before starting a runtime", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let runtimeStartCalls = 0;
      const adapter = yield* makeTestAdapter(() => {
        runtimeStartCalls += 1;
        return Effect.die("runtime must not start for invalid Pi mode flags");
      });

      const result = yield* adapter
        .startSession({
          threadId: ThreadId.make("pi-invalid-mode-flag"),
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: ProviderInstanceId.make("piAgent"),
            model: "example/new-model",
            options: [{ id: "piModeFlags", value: "--unsafe-flag" }],
          },
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(runtimeStartCalls, 0);
      if (result._tag === "Failure") NodeAssert.match(result.failure.message, /--mode-/);
    }),
  ),
);

it.effect("rejects Pi launch arguments that override managed session flags", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let runtimeStartCalls = 0;
      const adapter = yield* makeTestAdapter(
        () => {
          runtimeStartCalls += 1;
          return Effect.die("runtime must not start for managed launch flags");
        },
        { settings: { launchArgs: "--mode text" } },
      );

      const result = yield* adapter
        .startSession({
          threadId: ThreadId.make("pi-managed-launch-flag"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(runtimeStartCalls, 0);
      if (result._tag === "Failure") NodeAssert.match(result.failure.message, /managed by T3 Code/);
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

  const buffered = __PiAdapterTestKit.mapEvent(context, {
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

  const flushed = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", contentIndex: 0 },
  });
  const reasoningDelta = [...buffered, ...flushed].find(
    (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
  );

  NodeAssert.equal(reasoningDelta?.type, "content.delta");
  NodeAssert.equal(
    reasoningDelta?.type === "content.delta" ? reasoningDelta.payload.delta : undefined,
    "Think",
  );
  NodeAssert.ok([...buffered, ...flushed].every((event) => event.type !== "task.progress"));
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
  const flushed = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", contentIndex: 0 },
  });

  const reasoningDeltas = [...first, ...second, ...flushed].filter(
    (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
  );
  NodeAssert.deepEqual(
    reasoningDeltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
    ["Think more"],
  );
});

it("coalesces Pi reasoning without losing text", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const events = Array.from({ length: 1_000 }, () =>
    __PiAdapterTestKit.mapEvent(context, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "x" },
    }),
  ).flat();
  const flushed = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", contentIndex: 0 },
  });
  const reasoningDeltas = [...events, ...flushed].filter(
    (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
  );

  NodeAssert.equal(reasoningDeltas.length, 2);
  NodeAssert.equal(
    reasoningDeltas
      .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
      .join("").length,
    1_000,
  );
});

it("maps Pi stderr and turn usage into canonical events", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const stderr = __PiAdapterTestKit.mapEvent(context, {
    type: "stderr",
    message: "provider connection is slow",
  });
  const usage = __PiAdapterTestKit.mapEvent(context, {
    type: "turn_end",
    message: {
      role: "assistant",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 50,
        reasoning: 8,
        totalTokens: 170,
      },
    },
  });

  NodeAssert.equal(stderr[0]?.type, "runtime.warning");
  NodeAssert.equal(usage[0]?.type, "thread.token-usage.updated");
  if (usage[0]?.type === "thread.token-usage.updated") {
    NodeAssert.deepEqual(usage[0].payload.usage, {
      usedTokens: 170,
      inputTokens: 100,
      lastInputTokens: 100,
      cachedInputTokens: 50,
      lastCachedInputTokens: 50,
      outputTokens: 20,
      lastOutputTokens: 20,
      reasoningOutputTokens: 8,
      lastReasoningOutputTokens: 8,
      lastUsedTokens: 170,
    });
  }
});

it("maps Pi extension and JSON parse failures to runtime errors", () => {
  for (const rawEvent of [
    { type: "extension_error", message: "extension failed" },
    { type: "parse_error", message: "invalid JSONL" },
  ]) {
    const context = __PiAdapterTestKit.makeContext({ threadId, turnId });
    const events = __PiAdapterTestKit.mapEvent(context, rawEvent);
    NodeAssert.equal(events[0]?.type, "runtime.error");
  }
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

it("buffers Pi tool-call JSON deltas until execution starts", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const toolStart = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      toolCall: { id: "call-1", name: "bash" },
    },
  });
  const toolDeltas = Array.from({ length: 1_000 }, () =>
    __PiAdapterTestKit.mapEvent(context, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: " ",
      },
    }),
  ).flat();
  const toolEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: {
        id: "call-1",
        name: "bash",
        arguments: { command: "vp check", description: "Runs quality checks" },
      },
    },
  });
  const executionStart = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "vp check", description: "Runs quality checks" },
  });
  const executionUpdate = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    partialResult: { output: "check output" },
  });
  const executionEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    result: { output: "check output" },
    isError: false,
  });

  NodeAssert.deepEqual(toolStart, []);
  NodeAssert.deepEqual(toolDeltas, []);
  NodeAssert.deepEqual(toolEnd, []);

  const started = executionStart[0];
  NodeAssert.equal(started?.type, "item.started");
  const payload = started?.payload;
  NodeAssert.equal(payload?.itemType, "command_execution");
  NodeAssert.equal(payload?.title, "Ran command");
  NodeAssert.equal(payload?.detail, "vp check");
  NodeAssert.equal(payload?.toolCallId, "call-1");
  NodeAssert.equal(payload?.toolName, "bash");
  NodeAssert.deepEqual(payload?.toolPreview, { kind: "command", command: "vp check" });
  NodeAssert.equal(payload?.data, undefined);

  NodeAssert.equal(executionUpdate.length, 1);
  NodeAssert.equal(executionUpdate[0]?.type, "content.delta");
  NodeAssert.equal(
    executionUpdate[0]?.type === "content.delta" ? executionUpdate[0].payload.streamKind : null,
    "command_output",
  );
  NodeAssert.equal(executionUpdate[0]?.itemId, started?.itemId);

  NodeAssert.equal(executionEnd.length, 1);
  const completed = executionEnd[0];
  NodeAssert.equal(completed?.type, "item.completed");
  NodeAssert.equal(completed?.itemId, started?.itemId);
  NodeAssert.deepEqual(completed?.payload.toolPreview, {
    kind: "command",
    command: "vp check",
    output: "check output",
  });
  NodeAssert.equal(completed?.payload.data, undefined);
});

it("uses distinct Pi tool lifecycle state when content indexes are reused", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const executeTool = (toolCallId: string) => {
    __PiAdapterTestKit.mapEvent(context, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        toolCall: { id: toolCallId, name: "read" },
      },
    });
    __PiAdapterTestKit.mapEvent(context, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: toolCallId, name: "read", arguments: { path: `${toolCallId}.ts` } },
      },
    });
    const started = __PiAdapterTestKit.mapEvent(context, {
      type: "tool_execution_start",
      toolCallId,
      toolName: "read",
      args: { path: `${toolCallId}.ts` },
    });
    __PiAdapterTestKit.mapEvent(context, {
      type: "tool_execution_end",
      toolCallId,
      toolName: "read",
      result: { output: toolCallId },
      isError: false,
    });
    return started.find((event) => event.type === "item.started");
  };

  const first = executeTool("call-1");
  const second = executeTool("call-2");

  NodeAssert.equal(first?.type, "item.started");
  NodeAssert.equal(second?.type, "item.started");
  NodeAssert.notEqual(first?.itemId, second?.itemId);
});

it("keeps Pi tool result content in bounded canonical preview", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });

  const toolEnd = __PiAdapterTestKit.mapEvent(context, {
    type: "tool_execution_end",
    toolCallId: "call-read",
    toolName: "read",
    result: { content: [{ type: "text", text: "file contents" }] },
    isError: false,
  });

  const completed = toolEnd.find((event) => event.type === "item.completed");
  NodeAssert.equal(completed?.type, "item.completed");
  NodeAssert.deepEqual(completed?.payload.toolPreview, {
    kind: "read",
    path: "Unknown path",
    content: "file contents",
  });
  NodeAssert.equal(completed?.payload.data, undefined);
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

it("settles active turns when the Pi child errors without an exit event", () => {
  const context = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const events = __PiAdapterTestKit.mapEvent(context, {
    type: "process_error",
    message: "Pi RPC process error.",
  });

  NodeAssert.equal(events.filter((event) => event.type === "runtime.error").length, 1);
  NodeAssert.equal(events.find((event) => event.type === "turn.completed")?.type, "turn.completed");
  NodeAssert.equal(events.at(-1)?.type, "session.exited");
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
      const interruptFiber = yield* adapter
        .interruptTurn(testThreadId, turn.turnId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* fake.emit({ type: "agent_settled" });
      yield* Fiber.join(interruptFiber);
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
      const interruptFiber = yield* adapter
        .interruptTurn(testThreadId, turn.turnId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* fake.emit({ type: "agent_settled" });
      yield* Fiber.join(interruptFiber);

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
        NodeAssert.deepEqual(ready.payload, { state: "ready", reason: "agent_settled" });
      }
    }),
  ),
);

it.effect("does not start the next Pi turn until the interrupted turn settles", () =>
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
      const interruptFiber = yield* adapter
        .interruptTurn(testThreadId, interruptedTurn.turnId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      const nextTurnFiber = yield* adapter
        .sendTurn({
          threadId: testThreadId,
          input: "continue",
          attachments: [],
        })
        .pipe(Effect.forkChild);
      yield* fake.emit({ type: "agent_settled" });
      yield* Fiber.join(interruptFiber);
      const nextTurn = yield* Fiber.join(nextTurnFiber);

      const session = (yield* adapter.listSessions())[0];
      NodeAssert.equal(session?.status, "running");
      NodeAssert.equal(session?.activeTurnId, nextTurn.turnId);
      NodeAssert.notEqual(nextTurn.turnId, interruptedTurn.turnId);
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
      const interruptFiber = yield* adapter
        .interruptTurn(testThreadId, interruptedTurn.turnId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* fake.emit({ type: "agent_settled" });
      yield* Fiber.join(interruptFiber);

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
      yield* nextRuntimeEvent(adapter);
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
      const configured = yield* nextRuntimeEvent(adapter);
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
      NodeAssert.equal(configured._tag, "Some");
      if (configured._tag === "Some") {
        NodeAssert.equal(configured.value.type, "session.configured");
      }
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

it.effect("presents Pi ask_user_question as one native questionnaire", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-questionnaire");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "tool_execution_start",
        toolCallId: "ask-1",
        toolName: "ask_user_question",
        args: {
          questions: [
            {
              question: "Pick path?",
              header: "Path",
              options: [
                { label: "Fast", description: "Ship quickly" },
                { label: "Safe", description: "Reduce risk" },
              ],
            },
            {
              question: "Pick layout?",
              header: "Layout",
              options: [
                {
                  label: "Timeline",
                  description: "Show progress",
                  preview: "✓ Connected\n● Editing files",
                },
                { label: "Badges", description: "Show compact badges" },
              ],
            },
            {
              question: "Pick checks?",
              header: "Checks",
              multiSelect: true,
              options: [
                { label: "Lint, format", description: "Run lint and format" },
                { label: "Tests", description: "Run tests" },
              ],
            },
          ],
        },
      });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: "primitive-1",
        method: "select",
        title: "Pick path?",
        options: ["Fast", "Safe", "Type something."],
      });
      const requested = yield* nextRuntimeEvent(adapter);

      NodeAssert.equal(requested._tag, "Some");
      if (requested._tag === "Some" && requested.value.type === "user-input.requested") {
        NodeAssert.deepEqual(requested.value.payload.questions, [
          {
            id: "0",
            header: "Path",
            question: "Pick path?",
            options: [
              { label: "Fast", description: "Ship quickly" },
              { label: "Safe", description: "Reduce risk" },
            ],
            multiSelect: false,
          },
          {
            id: "1",
            header: "Layout",
            question: "Pick layout?",
            options: [
              {
                label: "Timeline",
                description: "Show progress",
              },
              { label: "Badges", description: "Show compact badges" },
            ],
            multiSelect: false,
          },
          {
            id: "2",
            header: "Checks",
            question: "Pick checks?",
            options: [
              { label: "Lint, format", description: "Run lint and format" },
              { label: "Tests", description: "Run tests" },
            ],
            multiSelect: true,
          },
        ]);
      }

      yield* adapter.respondToUserInput(testThreadId, ApprovalRequestId.make("primitive-1"), {
        "0": "Fast",
        "1": "Timeline",
        "2": ["Lint, format", "Tests"],
      });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: "primitive-2",
        method: "editor",
        title:
          "Pick layout?\n\n- Timeline: Show progress\n\n✓ Connected\n● Editing files\n\n- Badges: Show compact badges\n\nEnter one option label exactly.",
        prefill: "",
      });
      yield* Effect.yieldNow;
      yield* fake.emit({
        type: "extension_ui_request",
        id: "primitive-3",
        method: "editor",
        title:
          'Pick checks?\n\n- Lint, format: Run lint and format\n- Tests: Run tests\n\nEnter one or more option labels, separated by commas or new lines. Enter "Chat about this" to continue in chat instead.',
        prefill: "",
      });
      yield* Effect.yieldNow;

      NodeAssert.deepEqual(fake.notifications, [
        { type: "extension_ui_response", id: "primitive-1", value: "Fast" },
        { type: "extension_ui_response", id: "primitive-2", value: "Timeline" },
        {
          type: "extension_ui_response",
          id: "primitive-3",
          value: '["Lint, format","Tests"]',
        },
      ]);
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

it("preserves Pi input placeholders and editor prefill", () => {
  const inputContext = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const input = __PiAdapterTestKit.mapEvent(inputContext, {
    type: "extension_ui_request",
    id: "input-placeholder",
    method: "input",
    title: "Name the branch",
    placeholder: "feature/example",
  });
  const editorContext = __PiAdapterTestKit.makeContext({ threadId, turnId });
  const editor = __PiAdapterTestKit.mapEvent(editorContext, {
    type: "extension_ui_request",
    id: "editor-prefill",
    method: "editor",
    title: "Edit release notes",
    prefill: "## Changes\n",
  });

  NodeAssert.equal(input[0]?.type, "user-input.requested");
  NodeAssert.equal(editor[0]?.type, "user-input.requested");
  if (input[0]?.type === "user-input.requested") {
    NodeAssert.deepEqual(input[0].payload.questions[0], {
      id: "input-placeholder",
      header: "input",
      question: "Name the branch",
      options: [],
      placeholder: "feature/example",
    });
  }
  if (editor[0]?.type === "user-input.requested") {
    NodeAssert.deepEqual(editor[0].payload.questions[0], {
      id: "editor-prefill",
      header: "editor",
      question: "Edit release notes",
      options: [],
      defaultValue: "## Changes\n",
    });
  }
});

it("does not aggregate incompatible or unrelated Pi UI requests", () => {
  const screenshotContext = __PiAdapterTestKit.makeContext({ threadId, turnId });
  __PiAdapterTestKit.mapEvent(screenshotContext, {
    type: "tool_execution_start",
    toolCallId: "screenshot-question",
    toolName: "ask_user_question",
    args: {
      questions: [
        {
          question: "Upload screenshot?",
          header: "Screenshot",
          screenshotRequest: { prompt: "Upload the broken screen" },
          options: [],
        },
      ],
    },
  });
  const screenshotRequest = __PiAdapterTestKit.mapEvent(screenshotContext, {
    type: "extension_ui_request",
    id: "screenshot-input",
    method: "input",
    title: "Upload screenshot?\n\nUpload via http://localhost/upload",
  });

  NodeAssert.equal(screenshotRequest[0]?.type, "user-input.requested");
  if (screenshotRequest[0]?.type === "user-input.requested") {
    NodeAssert.equal(screenshotRequest[0].payload.questions.length, 1);
    NodeAssert.equal(
      screenshotRequest[0].payload.questions[0]?.question,
      "Upload screenshot?\n\nUpload via http://localhost/upload",
    );
  }

  const interleavedContext = __PiAdapterTestKit.makeContext({ threadId, turnId });
  __PiAdapterTestKit.mapEvent(interleavedContext, {
    type: "tool_execution_start",
    toolCallId: "ask-interleaved",
    toolName: "ask_user_question",
    args: {
      questions: [
        {
          question: "Pick path?",
          header: "Path",
          options: [
            { label: "Fast", description: "Ship quickly" },
            { label: "Safe", description: "Reduce risk" },
          ],
        },
      ],
    },
  });
  const unrelatedRequest = __PiAdapterTestKit.mapEvent(interleavedContext, {
    type: "extension_ui_request",
    id: "unrelated-input",
    method: "input",
    title: "Extension API key",
  });

  NodeAssert.equal(unrelatedRequest[0]?.type, "user-input.requested");
  if (unrelatedRequest[0]?.type === "user-input.requested") {
    NodeAssert.deepEqual(unrelatedRequest[0].payload.questions, [
      {
        id: "unrelated-input",
        header: "input",
        question: "Extension API key",
        options: [],
      },
    ]);
  }
});

it.effect("expires Pi dialog requests when the upstream timeout elapses", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-ui-timeout");
      const requestId = ApprovalRequestId.make("input-timeout");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: requestId,
        method: "input",
        title: "Temporary input",
        timeout: 1_000,
      });
      const requested = yield* nextRuntimeEvent(adapter);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
      const resolved = yield* nextRuntimeEvent(adapter);
      const staleResponse = yield* adapter
        .respondToUserInput(testThreadId, requestId, { [requestId]: "too late" })
        .pipe(Effect.result);

      NodeAssert.equal(requested._tag, "Some");
      if (requested._tag === "Some") NodeAssert.equal(requested.value.type, "user-input.requested");
      NodeAssert.equal(resolved._tag, "Some");
      if (resolved._tag === "Some") {
        NodeAssert.equal(resolved.value.type, "user-input.resolved");
      }
      NodeAssert.equal(staleResponse._tag, "Failure");
      NodeAssert.deepEqual(fake.notifications, []);
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

it.effect("forwards Pi image attachments through RPC", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const attachmentsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pi-images-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(attachmentsDir, { recursive: true, force: true })),
      );
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime), {
        attachmentsDir,
      });
      const testThreadId = ThreadId.make("pi-image-attachment");
      const attachment = {
        type: "image" as const,
        id: "pi-image-attachment-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const attachmentPath = resolveAttachmentPath({ attachmentsDir, attachment });
      NodeAssert.ok(attachmentPath);
      NodeFS.mkdirSync(NodePath.dirname(attachmentPath), { recursive: true });
      NodeFS.writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "Read this image.",
        attachments: [attachment],
      });

      NodeAssert.deepEqual(fake.requests, [
        { type: "get_state" },
        {
          type: "prompt",
          message: "Read this image.",
          images: [{ type: "image", data: "AQIDBA==", mimeType: "image/png" }],
        },
      ]);
    }),
  ),
);

it.effect("rejects oversized combined Pi image payloads before reading files", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-image-total-limit");
      const attachments = Array.from({ length: 3 }, (_, index) => ({
        type: "image" as const,
        id: `pi-image-total-${index}`,
        name: `image-${index}.png`,
        mimeType: "image/png",
        sizeBytes: 10 * 1024 * 1024,
      }));

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const result = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "Read images", attachments })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.deepEqual(fake.requests, [{ type: "get_state" }]);
      if (result._tag === "Failure") NodeAssert.match(result.failure.message, /combined limit/);
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

it.effect("reads only the active Pi branch and reconstructs turn boundaries", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entries = {
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
            id: "abandoned-user",
            parentId: "assistant-1",
            type: "message",
            message: { role: "user" },
          },
          {
            id: "abandoned-assistant",
            parentId: "abandoned-user",
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
        if (command.type === "get_state") return Effect.succeed(initialState());
        if (command.type === "get_entries") return Effect.succeed(entries);
        return Effect.succeed({});
      });
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-active-branch");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      const snapshot = yield* adapter.readThread(testThreadId);

      NodeAssert.equal(snapshot.turns.length, 2);
      NodeAssert.deepEqual(
        snapshot.turns.map((turn) =>
          turn.items.map((item) => (item as { readonly id: string }).id),
        ),
        [
          ["user-1", "assistant-1"],
          ["user-2", "assistant-2"],
        ],
      );
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

it.effect("uses follow_up for an active queued Pi delivery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime));
      const testThreadId = ThreadId.make("pi-follow-up");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* adapter.sendTurn({ threadId: testThreadId, input: "first", attachments: [] });
      yield* adapter.sendTurn({
        threadId: testThreadId,
        input: "queued",
        attachments: [],
        delivery: "followUp",
      });

      NodeAssert.deepEqual(
        fake.requests.map((command) => command.type),
        ["get_state", "prompt", "follow_up"],
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
      const closedSend = yield* adapter
        .sendTurn({ threadId: testThreadId, input: "too late", attachments: [] })
        .pipe(Effect.result);
      yield* fake.end;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      NodeAssert.equal(yield* adapter.hasSession(testThreadId), false);
      NodeAssert.deepEqual(yield* adapter.listSessions(), []);
      NodeAssert.equal(fake.closeCalls(), 1);
      NodeAssert.equal(closedSend._tag, "Failure");
      if (closedSend._tag === "Failure") NodeAssert.match(closedSend.failure.message, /closed/i);
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

it.effect("skips noisy Pi status and tool-call delta native logs", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const nativeEvents: unknown[] = [];
      const nativeEventLogger: EventNdjsonLogger = {
        filePath: "memory://pi-native-filtered-events",
        write: (event) => Effect.sync(() => void nativeEvents.push(event)),
        close: () => Effect.void,
      };
      const fake = yield* makeFakePiRuntime((command) =>
        command.type === "get_state" ? Effect.succeed(initialState()) : Effect.succeed({}),
      );
      const adapter = yield* makeTestAdapter(() => Effect.succeed(fake.runtime), {
        nativeEventLogger,
      });
      const testThreadId = ThreadId.make("pi-native-filtered-events");

      yield* adapter.startSession({ threadId: testThreadId, runtimeMode: "full-access" });
      yield* nextRuntimeEvent(adapter);
      yield* fake.emit({
        type: "extension_ui_request",
        id: "status-noise",
        method: "setStatus",
        statusKey: "usage",
        statusText: "50%",
      });
      yield* fake.emit({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "x" },
      });
      yield* fake.emit({ type: "agent_start" });
      yield* nextRuntimeEvent(adapter);

      NodeAssert.equal(nativeEvents.length, 1);
      const logged = nativeEvents[0] as { readonly event: { readonly method: string } };
      NodeAssert.equal(logged.event.method, "agent_start");
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

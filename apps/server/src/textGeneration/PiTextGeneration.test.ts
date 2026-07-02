import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PiAgentSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  PiRpcRuntimeError,
  type PiRpcCommand,
  type PiRpcRawEvent,
  type PiRpcRuntimeShape,
} from "../provider/piRpcRuntime.ts";
import { makePiTextGeneration } from "./PiTextGeneration.ts";

const decodePiSettings = Schema.decodeSync(PiAgentSettings);

interface FakePiTextRuntime {
  readonly runtime: PiRpcRuntimeShape;
  readonly promptReceived: Deferred.Deferred<void>;
  readonly emit: (event: unknown) => Effect.Effect<void>;
  readonly getLastAssistantTextCalls: () => number;
}

function makeFakePiTextRuntime(text: string): Effect.Effect<FakePiTextRuntime> {
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<PiRpcRawEvent>();
    const promptReceived = yield* Deferred.make<void>();
    let getLastAssistantTextCallCount = 0;
    const runtime: PiRpcRuntimeShape = {
      request: <T>(command: PiRpcCommand) => {
        switch (command.type) {
          case "prompt":
            return Deferred.succeed(promptReceived, undefined).pipe(
              Effect.as({} as T),
            ) as Effect.Effect<T, PiRpcRuntimeError>;
          case "get_last_assistant_text":
            return Effect.sync(() => {
              getLastAssistantTextCallCount += 1;
              return { text } as T;
            });
          default:
            return Effect.succeed({} as T);
        }
      },
      notify: () => Effect.void,
      events: Stream.fromQueue(events),
      close: Effect.void,
    };
    return {
      runtime,
      promptReceived,
      emit: (event) => Queue.offer(events, { event }),
      getLastAssistantTextCalls: () => getLastAssistantTextCallCount,
    };
  });
}

function fakeRuntimeFactory(fake: FakePiTextRuntime) {
  return () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      yield* Scope.addFinalizer(scope, fake.runtime.close);
      return fake.runtime;
    });
}

function generateThreadTitle(fake: FakePiTextRuntime) {
  return Effect.gen(function* () {
    const textGeneration = yield* makePiTextGeneration(
      decodePiSettings({ binaryPath: "pi" }),
      undefined,
      { makeRuntime: fakeRuntimeFactory(fake) },
    );
    return yield* textGeneration.generateThreadTitle({
      cwd: process.cwd(),
      message: "fix Pi lifecycle",
      modelSelection: createModelSelection(ProviderInstanceId.make("piAgent"), "example/model"),
    });
  });
}

it.effect("waits for agent_settled before reading Pi text output", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiTextRuntime('{"title":"Settled title"}');
      const generationFiber = yield* generateThreadTitle(fake).pipe(Effect.forkChild);

      yield* Deferred.await(fake.promptReceived);
      yield* fake.emit({ type: "agent_end" });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      NodeAssert.equal(fake.getLastAssistantTextCalls(), 0);

      yield* fake.emit({ type: "agent_settled" });
      const generated = yield* Fiber.join(generationFiber);

      NodeAssert.equal(generated.title, "Settled title");
      NodeAssert.equal(fake.getLastAssistantTextCalls(), 1);
    }),
  ),
);

it.effect("fails one-shot Pi generation after a terminal model error settles", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiTextRuntime('{"title":"unused"}');
      const generationFiber = yield* generateThreadTitle(fake).pipe(Effect.forkChild);

      yield* Deferred.await(fake.promptReceived);
      yield* fake.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "error",
          reason: "error",
          error: { errorMessage: "model overloaded" },
        },
      });
      yield* fake.emit({ type: "auto_retry_end", success: false, finalError: "model overloaded" });
      yield* fake.emit({ type: "agent_settled" });
      const result = yield* Fiber.join(generationFiber).pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "TextGenerationError");
      NodeAssert.match(result.failure.detail, /model overloaded/i);
      NodeAssert.equal(fake.getLastAssistantTextCalls(), 0);
    }),
  ),
);

it.effect("clears transient Pi model errors after a successful retry", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiTextRuntime('{"title":"Recovered title"}');
      const generationFiber = yield* generateThreadTitle(fake).pipe(Effect.forkChild);

      yield* Deferred.await(fake.promptReceived);
      yield* fake.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "error",
          reason: "error",
          error: { errorMessage: "rate limited" },
        },
      });
      yield* fake.emit({ type: "agent_end", willRetry: true });
      yield* fake.emit({ type: "auto_retry_end", success: true });
      yield* fake.emit({ type: "agent_settled" });
      const generated = yield* Fiber.join(generationFiber);

      NodeAssert.equal(generated.title, "Recovered title");
      NodeAssert.equal(fake.getLastAssistantTextCalls(), 1);
    }),
  ),
);

it.effect("fails one-shot Pi generation when its RPC process exits before settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* makeFakePiTextRuntime('{"title":"unused"}');
      const generationFiber = yield* generateThreadTitle(fake).pipe(Effect.forkChild);

      yield* Deferred.await(fake.promptReceived);
      yield* fake.emit({ type: "process_exit", code: 17, signal: null });
      const result = yield* Fiber.join(generationFiber).pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "TextGenerationError");
      NodeAssert.match(result.failure.detail, /process exited/i);
      NodeAssert.equal(fake.getLastAssistantTextCalls(), 0);
    }),
  ),
);

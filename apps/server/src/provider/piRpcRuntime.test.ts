// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import type * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import {
  __PiRpcRuntimeTestKit,
  PiRpcRuntimeError,
  type PiRpcRuntimeShape,
} from "./piRpcRuntime.ts";

class FakeStdin {
  writable = true;
  writeError: Error | undefined;
  readonly writes: string[] = [];

  write(chunk: string, callback: (error?: Error | null) => void): boolean {
    this.writes.push(chunk);
    const error = this.writeError;
    this.writeError = undefined;
    callback(error);
    return true;
  }
}

class FakePiChildProcess extends NodeEvents.EventEmitter {
  readonly stdout = new NodeStream.PassThrough();
  readonly stderr = new NodeStream.PassThrough();
  readonly stdin = new FakeStdin();
  readonly signals: NodeJS.Signals[] = [];
  killResult = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal?: NodeJS.Signals | number): boolean {
    if (typeof signal === "string") this.signals.push(signal);
    return this.killResult;
  }

  writeStdout(value: string): void {
    this.stdout.write(value);
  }

  writeStderr(value: string): void {
    this.stderr.write(value);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  emitClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit("close", code, signal);
  }

  emitProcessError(cause: Error): void {
    this.emit("error", cause);
  }

  asChildProcess(): NodeChildProcess.ChildProcessWithoutNullStreams {
    return this as unknown as NodeChildProcess.ChildProcessWithoutNullStreams;
  }
}

class ManualTimers {
  private nextTimerId = 0;
  private readonly timers = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number }
  >();
  readonly scheduledDelays: number[] = [];

  schedule = (callback: () => void, delayMs: number): number => {
    const timerId = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(timerId, { callback, delayMs });
    this.scheduledDelays.push(delayMs);
    return timerId;
  };

  cancel = (timerId: unknown): void => {
    if (typeof timerId === "number") this.timers.delete(timerId);
  };

  get activeCount(): number {
    return this.timers.size;
  }

  runAll(): void {
    while (this.timers.size > 0) {
      const [timerId, timer] = this.timers.entries().next().value ?? [];
      if (timerId === undefined || timer === undefined) return;
      this.timers.delete(timerId);
      timer.callback();
    }
  }
}

function makeRuntime(
  child: FakePiChildProcess,
  timers = new ManualTimers(),
  options: { readonly requestTimeoutMs?: number; readonly closeGracePeriodMs?: number } = {},
): Effect.Effect<{ readonly runtime: PiRpcRuntimeShape; readonly timers: ManualTimers }> {
  return __PiRpcRuntimeTestKit
    .make(child.asChildProcess(), options, timers)
    .pipe(Effect.map((runtime) => ({ runtime, timers })));
}

it.effect("frames partial Pi RPC JSONL output", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const { runtime } = yield* makeRuntime(child);

    child.writeStdout('{"type":"message_update","message":{"id":"partial"');
    child.writeStdout("}}\n");

    const event = yield* Stream.runHead(runtime.events);
    NodeAssert.equal(event._tag, "Some");
    if (event._tag === "Some") {
      NodeAssert.deepEqual(event.value.event, {
        type: "message_update",
        message: { id: "partial" },
      });
    }
  }),
);

it.effect("backpressures Pi RPC events without dropping output", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const { runtime } = yield* makeRuntime(child);
    const eventCount = 300;

    child.writeStdout(
      Array.from(
        { length: eventCount },
        (_, index) => `${JSON.stringify({ type: "event", index })}\n`,
      ).join(""),
    );
    child.emitExit(0, null);
    child.emitClose(0, null);

    const events = Array.from(yield* Stream.runCollect(runtime.events)).map((event) => event.event);
    NodeAssert.equal(events.length, eventCount + 1);
    NodeAssert.deepEqual(
      events.slice(0, eventCount),
      Array.from({ length: eventCount }, (_, index) => ({ type: "event", index })),
    );
    NodeAssert.deepEqual(events[eventCount], { type: "process_exit", code: 0, signal: null });
  }),
);

it.effect("times out Pi RPC requests using configured timeout", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers, { requestTimeoutMs: 17 });
    const request = yield* runtime
      .request({ type: "get_state", id: "timeout-request" })
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    NodeAssert.equal(child.stdin.writes.length, 1);
    NodeAssert.deepEqual(timers.scheduledDelays, [17]);
    timers.runAll();

    const result = yield* Fiber.join(request);
    NodeAssert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      NodeAssert.ok(result.failure instanceof PiRpcRuntimeError);
      NodeAssert.match(result.failure.detail, /timed out after 17ms/);
    }
    NodeAssert.equal(timers.activeCount, 0);
  }),
);

it.effect("clears request timeout when Pi RPC command writing fails", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    child.stdin.writeError = new Error("stdin unavailable");
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers, { requestTimeoutMs: 18 });

    const result = yield* runtime
      .request({ type: "get_state", id: "write-failure-request" })
      .pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      NodeAssert.ok(result.failure instanceof PiRpcRuntimeError);
      NodeAssert.equal(result.failure.detail, "Failed to write Pi RPC command.");
    }
    NodeAssert.equal(timers.activeCount, 0);
  }),
);

it.effect("clears request timeout on response and leaves unmatched responses as events", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers, { requestTimeoutMs: 19 });
    const request = yield* runtime
      .request<{ readonly value: string }>({ type: "get_state", id: "active-request" })
      .pipe(Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    child.writeStdout('{"type":"response","id":"expired-request","success":true,"data":{}}\n');
    child.writeStdout(
      '{"type":"response","id":"active-request","success":true,"data":{"value":"ok"}}\n',
    );

    NodeAssert.deepEqual(yield* Fiber.join(request), { value: "ok" });
    NodeAssert.equal(timers.activeCount, 0);
    const event = yield* Stream.runHead(runtime.events);
    NodeAssert.equal(event._tag, "Some");
    if (event._tag === "Some") {
      NodeAssert.deepEqual(event.value.event, {
        type: "response",
        id: "expired-request",
        success: true,
        data: {},
      });
    }
  }),
);

it.effect("rejects duplicate Pi RPC request ids without replacing the active request", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers);
    const first = yield* runtime
      .request<{ readonly value: string }>({ type: "get_state", id: "duplicate-request" })
      .pipe(Effect.forkChild({ startImmediately: true }));

    const duplicate = yield* runtime
      .request({ type: "get_state", id: "duplicate-request" })
      .pipe(Effect.result);
    child.writeStdout(
      '{"type":"response","id":"duplicate-request","success":true,"data":{"value":"ok"}}\n',
    );

    NodeAssert.equal(duplicate._tag, "Failure");
    if (duplicate._tag === "Failure") NodeAssert.match(duplicate.failure.detail, /already pending/);
    NodeAssert.deepEqual(yield* Fiber.join(first), { value: "ok" });
    NodeAssert.equal(timers.activeCount, 0);
  }),
);

it.effect("clears pending Pi RPC requests and ends events on child error without exit", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers);
    const request = yield* runtime
      .request({ type: "get_state", id: "error-request" })
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    child.emitProcessError(new Error("spawn failed"));

    const result = yield* Fiber.join(request);
    NodeAssert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      NodeAssert.ok(result.failure instanceof PiRpcRuntimeError);
      NodeAssert.equal(result.failure.detail, "Pi RPC process error.");
    }
    NodeAssert.equal(timers.activeCount, 0);
    NodeAssert.deepEqual(
      Array.from(yield* Stream.runCollect(runtime.events)).map((event) => event.event),
      [{ type: "process_error", message: "Pi RPC process error." }],
    );
    yield* runtime.close;
  }),
);

it.effect("waits for graceful Pi process exit and cancels forced kill", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers, { closeGracePeriodMs: 23 });
    const close = yield* runtime.close.pipe(Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    NodeAssert.deepEqual(child.signals, ["SIGTERM"]);
    NodeAssert.deepEqual(timers.scheduledDelays, [23]);
    child.emitExit(0, "SIGTERM");
    child.emitClose(0, "SIGTERM");
    yield* Fiber.join(close);
    timers.runAll();

    NodeAssert.deepEqual(child.signals, ["SIGTERM"]);
    NodeAssert.deepEqual(
      Array.from(yield* Stream.runCollect(runtime.events)).map((event) => event.event),
      [{ type: "process_exit", code: 0, signal: "SIGTERM" }],
    );
  }),
);

it.effect("force kills Pi process after configured close grace period", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const timers = new ManualTimers();
    const { runtime } = yield* makeRuntime(child, timers, { closeGracePeriodMs: 29 });
    const close = yield* runtime.close.pipe(Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    NodeAssert.deepEqual(child.signals, ["SIGTERM"]);
    timers.runAll();
    NodeAssert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    child.emitExit(null, "SIGKILL");
    child.emitClose(null, "SIGKILL");
    yield* Fiber.join(close);
  }),
);

it.effect("ends Pi runtime close when the child rejects a termination signal", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    child.killResult = false;
    const { runtime } = yield* makeRuntime(child);

    yield* runtime.close;

    NodeAssert.deepEqual(child.signals, ["SIGTERM"]);
    NodeAssert.deepEqual(
      Array.from(yield* Stream.runCollect(runtime.events)).map((event) => event.event),
      [{ type: "process_error", message: "Pi RPC process error." }],
    );
  }),
);

it.effect("flushes trailing stdout JSONL and stderr before ending events", () =>
  Effect.gen(function* () {
    const child = new FakePiChildProcess();
    const { runtime } = yield* makeRuntime(child);

    child.emitExit(0, null);
    child.writeStdout('{"type":"agent_settled","turnIndex":3}');
    child.writeStderr("trailing diagnostic");
    child.emitClose(0, null);

    NodeAssert.deepEqual(
      Array.from(yield* Stream.runCollect(runtime.events)).map((event) => event.event),
      [
        { type: "agent_settled", turnIndex: 3 },
        { type: "stderr", message: "trailing diagnostic" },
        { type: "process_exit", code: 0, signal: null },
      ],
    );
  }),
);

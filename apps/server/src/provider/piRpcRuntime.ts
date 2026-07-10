// @effect-diagnostics nodeBuiltinImport:off - Pi RPC is a JSONL child-process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeTimers from "node:timers";
import * as NodeUtil from "node:util";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import type { Done } from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export const PiResumeCursorSchema = Schema.Struct({
  version: Schema.Literal(1),
  sessionFile: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
export type PiResumeCursor = typeof PiResumeCursorSchema.Type;

export interface PiRpcRuntimeOptions {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly extendEnv?: boolean | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly closeGracePeriodMs?: number | undefined;
}

export type PiRpcCommand = Record<string, unknown> & {
  readonly type: string;
  readonly id?: string;
};

export interface PiRpcRawEvent {
  readonly event: unknown;
}

export interface PiRpcRuntimeShape {
  readonly request: <T = unknown>(command: PiRpcCommand) => Effect.Effect<T, PiRpcRuntimeError>;
  readonly notify: (command: PiRpcCommand) => Effect.Effect<void, PiRpcRuntimeError>;
  readonly events: Stream.Stream<PiRpcRawEvent>;
  readonly close: Effect.Effect<void>;
}

export class PiRpcRuntimeError extends Data.TaggedError("PiRpcRuntimeError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

interface PendingRpcRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: unknown;
}

interface PendingEvent {
  readonly event: PiRpcRawEvent;
  readonly onQueued?: (() => void) | undefined;
}

interface PiRpcRuntimeTimers {
  readonly schedule: (callback: () => void, durationMs: number) => unknown;
  readonly cancel: (timeout: unknown) => void;
}

interface PiRpcRuntimeTiming {
  readonly requestTimeoutMs: number;
  readonly closeGracePeriodMs: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_PERIOD_MS = 2_000;
const EVENT_QUEUE_CAPACITY = 256;

const nodeTimers: PiRpcRuntimeTimers = {
  schedule: (callback, durationMs) => {
    // @effect-diagnostics-next-line globalTimers:off - Child-process callbacks require native timers.
    const timeout = NodeTimers.setTimeout(callback, durationMs);
    timeout.unref();
    return timeout;
  },
  cancel: (timeout) => NodeTimers.clearTimeout(timeout as NodeJS.Timeout),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toRuntimeError(error: unknown): PiRpcRuntimeError {
  return error instanceof PiRpcRuntimeError
    ? error
    : new PiRpcRuntimeError({
        detail: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}

function configuredDuration(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function timingFromOptions(
  options: Pick<PiRpcRuntimeOptions, "requestTimeoutMs" | "closeGracePeriodMs">,
): PiRpcRuntimeTiming {
  return {
    requestTimeoutMs: configuredDuration(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    closeGracePeriodMs: configuredDuration(
      options.closeGracePeriodMs,
      DEFAULT_CLOSE_GRACE_PERIOD_MS,
    ),
  };
}

class PiRpcProcessRuntime implements PiRpcRuntimeShape {
  private readonly stdoutDecoder = new NodeUtil.TextDecoder();
  private readonly stderrDecoder = new NodeUtil.TextDecoder();
  private readonly pending = new Map<string, PendingRpcRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stdoutFlushRequested = false;
  private stderrFlushRequested = false;
  private closed = false;
  private processExited = false;
  private processErrored = false;
  private processClosed = false;
  private acceptOutput = true;
  private outputPaused = false;
  private pendingEvent: PendingEvent | undefined;
  private terminalEvent: PiRpcRawEvent | undefined;
  private terminalEventPending = false;
  private terminalEventQueued = false;
  private endEventsRequested = false;
  private eventsEnded = false;
  private forceKillTimeout: unknown;
  private closeCompletion: Promise<void> | undefined;
  private resolveCloseCompletion: (() => void) | undefined;
  private readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  private readonly queue: Queue.Queue<PiRpcRawEvent, Done>;
  private readonly timing: PiRpcRuntimeTiming;
  private readonly timers: PiRpcRuntimeTimers;

  readonly events: Stream.Stream<PiRpcRawEvent>;
  readonly close: Effect.Effect<void> = Effect.promise(() => this.closeProcess());

  constructor(
    child: NodeChildProcess.ChildProcessWithoutNullStreams,
    queue: Queue.Queue<PiRpcRawEvent, Done>,
    timing: PiRpcRuntimeTiming,
    timers: PiRpcRuntimeTimers,
  ) {
    this.child = child;
    this.queue = queue;
    this.timing = timing;
    this.timers = timers;
    this.events = Stream.fromQueue(queue).pipe(
      Stream.tap(() => Effect.sync(() => this.afterEventDequeued())),
    );
    this.child.stdout.on("data", (chunk: Uint8Array) => this.handleStdoutChunk(chunk));
    this.child.stderr.on("data", (chunk: Uint8Array) => this.handleStderrChunk(chunk));
    this.child.stdout.once("close", () => this.handleStdoutClose());
    this.child.stderr.once("close", () => this.handleStderrClose());
    this.child.once("exit", (code, signal) => this.handleProcessExit(code, signal));
    this.child.once("error", (cause) => this.handleProcessError(cause));
    this.child.once("close", (code, signal) => this.handleProcessClose(code, signal));
  }

  request = <T = unknown>(command: PiRpcCommand): Effect.Effect<T, PiRpcRuntimeError> =>
    Effect.tryPromise({
      try: () => this.requestPromise<T>(command),
      catch: toRuntimeError,
    });

  notify = (command: PiRpcCommand): Effect.Effect<void, PiRpcRuntimeError> =>
    Effect.tryPromise({
      try: () => this.writeCommand(command),
      catch: toRuntimeError,
    });

  private writeCommand(command: PiRpcCommand): Promise<void> {
    if (this.closed || !this.child.stdin.writable) {
      return Promise.reject(new PiRpcRuntimeError({ detail: "Pi RPC process is not writable." }));
    }

    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          reject(
            new PiRpcRuntimeError({ detail: "Failed to write Pi RPC command.", cause: error }),
          );
          return;
        }
        resolve();
      });
    });
  }

  private requestPromise<T>(command: PiRpcCommand): Promise<T> {
    if (this.closed || !this.child.stdin.writable) {
      return Promise.reject(new PiRpcRuntimeError({ detail: "Pi RPC process is not writable." }));
    }

    const id = command.id ?? NodeCrypto.randomUUID();
    if (this.pending.has(id)) {
      return Promise.reject(
        new PiRpcRuntimeError({ detail: `Pi RPC request id '${id}' is already pending.` }),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const timeout = this.timers.schedule(() => {
        const pending = this.takePending(id);
        if (!pending) return;
        pending.reject(
          new PiRpcRuntimeError({
            detail: `Pi RPC request timed out after ${this.timing.requestTimeoutMs}ms.`,
          }),
        );
      }, this.timing.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.writeCommand({ ...command, id }).catch((error) => {
        const pending = this.takePending(id);
        pending?.reject(error);
      });
    });
  }

  private handleStdoutChunk(chunk: Uint8Array): void {
    if (!this.acceptOutput || this.eventsEnded) return;
    this.stdoutBuffer += this.stdoutDecoder.decode(chunk, { stream: true });
    this.drainAndMaybeEndEvents();
  }

  private handleStderrChunk(chunk: Uint8Array): void {
    if (!this.acceptOutput || this.eventsEnded) return;
    this.stderrBuffer += this.stderrDecoder.decode(chunk, { stream: true });
    this.drainAndMaybeEndEvents();
  }

  private drainStdoutLines(flush: boolean): void {
    const lines = this.stdoutBuffer.split("\n");
    const trailing = flush ? undefined : (lines.pop() ?? "");
    this.stdoutBuffer = "";
    for (let index = 0; index < lines.length; index += 1) {
      if (this.handleStdoutLine(lines[index] ?? "")) continue;
      this.stdoutBuffer = [
        ...lines.slice(index + 1),
        ...(trailing === undefined ? [] : [trailing]),
      ].join("\n");
      return;
    }
    this.stdoutBuffer = trailing ?? "";
  }

  private drainStderrLines(flush: boolean): void {
    const lines = this.stderrBuffer.split("\n");
    const trailing = flush ? undefined : (lines.pop() ?? "");
    this.stderrBuffer = "";
    for (let index = 0; index < lines.length; index += 1) {
      const message = (lines[index] ?? "").trim();
      if (message.length === 0 || this.offer({ type: "stderr", message })) continue;
      this.stderrBuffer = [
        ...lines.slice(index + 1),
        ...(trailing === undefined ? [] : [trailing]),
      ].join("\n");
      return;
    }
    this.stderrBuffer = trailing ?? "";
  }

  private handleStdoutLine(rawLine: string): boolean {
    const line = rawLine.trim();
    if (line.length === 0) return true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      return this.offer({
        type: "parse_error",
        line,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (!isRecord(parsed)) {
      return this.offer(parsed);
    }

    if (parsed.type === "response") {
      const id = readString(parsed, "id");
      if (id) {
        const pending = this.takePending(id);
        if (pending) {
          if (parsed.success === true) pending.resolve(parsed.data);
          else
            pending.reject(
              new PiRpcRuntimeError({
                detail: readString(parsed, "error") ?? "Pi RPC command failed.",
              }),
            );
          return true;
        }
      }
    }

    return this.offer(parsed);
  }

  private handleStdoutClose(): void {
    this.requestStdoutFlush();
    this.maybeRequestEndAfterOutputClose();
    this.drainAndMaybeEndEvents();
  }

  private handleStderrClose(): void {
    this.requestStderrFlush();
    this.maybeRequestEndAfterOutputClose();
    this.drainAndMaybeEndEvents();
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.processErrored) return;
    this.processExited = true;
    const error = new PiRpcRuntimeError({
      detail: this.processExitDetail(code, signal),
    });
    this.transitionToClosed(error);
    this.clearForceKillTimeout();
    this.resolveClose();
    this.terminalEvent ??= { event: { type: "process_exit", code, signal } };
    this.maybeRequestEndAfterOutputClose();
    this.drainAndMaybeEndEvents();
  }

  private handleProcessError(cause: unknown): void {
    if (this.processErrored || this.eventsEnded) return;
    this.processErrored = true;
    this.acceptOutput = false;
    const error = new PiRpcRuntimeError({ detail: "Pi RPC process error.", cause });
    this.transitionToClosed(error);
    this.clearForceKillTimeout();
    this.resolveClose();
    this.terminalEvent = { event: { type: "process_error", message: error.detail } };
    this.endEventsRequested = true;
    this.requestOutputFlush();
    this.drainAndMaybeEndEvents();
  }

  private handleProcessClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.processClosed = true;
    if (!this.processExited && !this.processErrored) {
      this.processExited = true;
      const error = new PiRpcRuntimeError({ detail: this.processExitDetail(code, signal) });
      this.transitionToClosed(error);
      this.terminalEvent ??= { event: { type: "process_exit", code, signal } };
    }
    this.clearForceKillTimeout();
    this.resolveClose();
    if (this.eventsEnded) return;
    this.requestOutputFlush();
    this.endEventsRequested = true;
    this.drainAndMaybeEndEvents();
  }

  private requestStdoutFlush(): void {
    if (this.stdoutFlushRequested) return;
    this.stdoutFlushRequested = true;
    this.stdoutBuffer += this.stdoutDecoder.decode();
  }

  private requestStderrFlush(): void {
    if (this.stderrFlushRequested) return;
    this.stderrFlushRequested = true;
    this.stderrBuffer += this.stderrDecoder.decode();
  }

  private requestOutputFlush(): void {
    this.requestStdoutFlush();
    this.requestStderrFlush();
  }

  private maybeRequestEndAfterOutputClose(): void {
    if (this.processExited && this.stdoutFlushRequested && this.stderrFlushRequested) {
      this.endEventsRequested = true;
    }
  }

  private drainAndMaybeEndEvents(): void {
    if (this.eventsEnded) return;
    this.drainOutput();
    if (
      !this.endEventsRequested ||
      this.pendingEvent !== undefined ||
      this.stdoutBuffer.length > 0 ||
      this.stderrBuffer.length > 0
    ) {
      return;
    }
    if (this.terminalEvent && !this.terminalEventPending && !this.terminalEventQueued) {
      this.terminalEventPending = true;
      this.offer(this.terminalEvent.event, () => {
        this.terminalEventPending = false;
        this.terminalEventQueued = true;
      });
    }
    if (this.terminalEvent && !this.terminalEventQueued) return;
    this.eventsEnded = true;
    this.acceptOutput = false;
    Queue.endUnsafe(this.queue);
  }

  private drainOutput(): void {
    if (this.pendingEvent) return;
    this.drainStdoutLines(this.stdoutFlushRequested);
    if (this.pendingEvent) return;
    this.drainStderrLines(this.stderrFlushRequested);
  }

  private offer(event: unknown, onQueued?: () => void): boolean {
    if (this.eventsEnded) return true;
    if (this.pendingEvent) return false;
    const queuedEvent = { event } satisfies PiRpcRawEvent;
    if (Queue.offerUnsafe(this.queue, queuedEvent)) {
      onQueued?.();
      return true;
    }
    this.pendingEvent = { event: queuedEvent, ...(onQueued ? { onQueued } : {}) };
    this.pauseOutput();
    return false;
  }

  private afterEventDequeued(): void {
    const pendingEvent = this.pendingEvent;
    if (pendingEvent) {
      if (!Queue.offerUnsafe(this.queue, pendingEvent.event)) return;
      this.pendingEvent = undefined;
      pendingEvent.onQueued?.();
    }
    this.resumeOutput();
    this.drainAndMaybeEndEvents();
  }

  private pauseOutput(): void {
    if (this.outputPaused || this.eventsEnded) return;
    this.outputPaused = true;
    this.child.stdout.pause();
    this.child.stderr.pause();
  }

  private resumeOutput(): void {
    if (!this.outputPaused || this.pendingEvent || this.eventsEnded || !this.acceptOutput) return;
    this.outputPaused = false;
    this.child.stdout.resume();
    this.child.stderr.resume();
  }

  private takePending(id: string): PendingRpcRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    this.timers.cancel(pending.timeout);
    return pending;
  }

  private transitionToClosed(error: PiRpcRuntimeError): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      this.timers.cancel(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private closeProcess(): Promise<void> {
    if (this.closeCompletion) return this.closeCompletion;
    if (this.processExited || this.processErrored || this.processClosed) return Promise.resolve();

    this.transitionToClosed(new PiRpcRuntimeError({ detail: "Pi RPC process closed." }));
    this.closeCompletion = new Promise<void>((resolve) => {
      this.resolveCloseCompletion = resolve;
    });
    this.sendSignal("SIGTERM");
    if (!this.processExited && !this.processErrored && !this.processClosed) {
      this.forceKillTimeout = this.timers.schedule(
        () => this.forceKill(),
        this.timing.closeGracePeriodMs,
      );
    }
    return this.closeCompletion;
  }

  private forceKill(): void {
    this.forceKillTimeout = undefined;
    if (this.processExited || this.processErrored || this.processClosed) return;
    this.sendSignal("SIGKILL");
  }

  private sendSignal(signal: NodeJS.Signals): void {
    try {
      if (!this.child.kill(signal)) {
        this.handleProcessError(new Error(`Failed to send ${signal} to the Pi RPC process.`));
      }
    } catch (cause) {
      this.handleProcessError(cause);
    }
  }

  private clearForceKillTimeout(): void {
    if (this.forceKillTimeout === undefined) return;
    this.timers.cancel(this.forceKillTimeout);
    this.forceKillTimeout = undefined;
  }

  private resolveClose(): void {
    this.resolveCloseCompletion?.();
    this.resolveCloseCompletion = undefined;
  }

  private processExitDetail(code: number | null, signal: NodeJS.Signals | null): string {
    return `Pi RPC process exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
  }
}

function makePiRpcProcessRuntime(
  child: NodeChildProcess.ChildProcessWithoutNullStreams,
  options: Pick<PiRpcRuntimeOptions, "requestTimeoutMs" | "closeGracePeriodMs">,
  timers: PiRpcRuntimeTimers = nodeTimers,
): Effect.Effect<PiRpcRuntimeShape> {
  return Queue.bounded<PiRpcRawEvent, Done>(EVENT_QUEUE_CAPACITY).pipe(
    Effect.map(
      (queue) => new PiRpcProcessRuntime(child, queue, timingFromOptions(options), timers),
    ),
  );
}

export const __PiRpcRuntimeTestKit = {
  make: (
    child: NodeChildProcess.ChildProcessWithoutNullStreams,
    options: Pick<PiRpcRuntimeOptions, "requestTimeoutMs" | "closeGracePeriodMs"> = {},
    timers: PiRpcRuntimeTimers = nodeTimers,
  ): Effect.Effect<PiRpcRuntimeShape> => makePiRpcProcessRuntime(child, options, timers),
};

export const makePiRpcRuntime = (
  options: PiRpcRuntimeOptions,
): Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const spawnCommandOptions = {
      ...(options.env ? { env: options.env } : {}),
      extendEnv: options.extendEnv ?? true,
    };
    const spawnCommand = yield* resolveSpawnCommand(
      options.binaryPath,
      options.args,
      spawnCommandOptions,
    ).pipe(
      Effect.mapError(
        (cause) => new PiRpcRuntimeError({ detail: "Failed to resolve Pi command.", cause }),
      ),
    );

    const child = yield* Effect.try({
      try: () =>
        NodeChildProcess.spawn(spawnCommand.command, spawnCommand.args, {
          cwd: options.cwd,
          env: { ...(options.extendEnv === false ? {} : process.env), ...options.env },
          shell: spawnCommand.shell,
          stdio: "pipe",
        }),
      catch: (cause) => new PiRpcRuntimeError({ detail: "Failed to spawn Pi RPC process.", cause }),
    });
    const runtime = yield* makePiRpcProcessRuntime(child, options);
    yield* Scope.addFinalizer(scope, runtime.close);
    return runtime;
  });

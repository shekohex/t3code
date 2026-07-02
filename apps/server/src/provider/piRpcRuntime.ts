// @effect-diagnostics nodeBuiltinImport:off - Pi RPC is a JSONL child-process boundary.
// @effect-diagnostics globalTimersInEffect:off - Force-kill timeout is tied to process teardown.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
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
}

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

function rejectAllPending(pending: Map<string, PendingRpcRequest>, error: PiRpcRuntimeError): void {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

class PiRpcProcessRuntime implements PiRpcRuntimeShape {
  private readonly stdoutDecoder = new NodeUtil.TextDecoder();
  private readonly stderrDecoder = new NodeUtil.TextDecoder();
  private readonly pending = new Map<string, PendingRpcRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private closed = false;
  private readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  private readonly queue: Queue.Queue<PiRpcRawEvent>;

  readonly events: Stream.Stream<PiRpcRawEvent>;

  constructor(
    child: NodeChildProcess.ChildProcessWithoutNullStreams,
    queue: Queue.Queue<PiRpcRawEvent>,
  ) {
    this.child = child;
    this.queue = queue;
    this.events = Stream.fromQueue(queue);
    this.child.stdout.on("data", (chunk: Uint8Array) => this.handleStdoutChunk(chunk));
    this.child.stderr.on("data", (chunk: Uint8Array) => this.handleStderrChunk(chunk));
    this.child.once("exit", (code, signal) => {
      this.closed = true;
      const error = new PiRpcRuntimeError({
        detail: `Pi RPC process exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      });
      rejectAllPending(this.pending, error);
      Effect.runFork(
        Queue.offer(this.queue, { event: { type: "process_exit", code, signal } }).pipe(
          Effect.andThen(Queue.shutdown(this.queue)),
          Effect.ignore,
        ),
      );
    });
    this.child.once("error", (cause) => {
      const error = new PiRpcRuntimeError({ detail: "Pi RPC process error.", cause });
      rejectAllPending(this.pending, error);
      this.offer({ type: "process_error", message: error.detail });
    });
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

  close = Effect.sync(() => {
    if (this.closed) return;
    this.closed = true;
    const error = new PiRpcRuntimeError({ detail: "Pi RPC process closed." });
    rejectAllPending(this.pending, error);
    this.child.kill("SIGTERM");
    setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null)
        this.child.kill("SIGKILL");
    }, 2_000).unref();
    Effect.runFork(Queue.shutdown(this.queue));
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
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.writeCommand({ ...command, id }).catch((error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private handleStdoutChunk(chunk: Uint8Array): void {
    this.stdoutBuffer += this.stdoutDecoder.decode(chunk, { stream: true });
    this.drainStdoutLines(false);
  }

  private handleStderrChunk(chunk: Uint8Array): void {
    this.stderrBuffer += this.stderrDecoder.decode(chunk, { stream: true });
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const message = line.trim();
      if (message.length > 0) this.offer({ type: "stderr", message });
    }
  }

  private drainStdoutLines(flush: boolean): void {
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) this.handleStdoutLine(line);
  }

  private handleStdoutLine(rawLine: string): void {
    const line = rawLine.trim();
    if (line.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      this.offer({
        type: "parse_error",
        line,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    if (!isRecord(parsed)) {
      this.offer(parsed);
      return;
    }

    if (parsed.type === "response") {
      const id = readString(parsed, "id");
      if (id) {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          if (parsed.success === true) pending.resolve(parsed.data);
          else
            pending.reject(
              new PiRpcRuntimeError({
                detail: readString(parsed, "error") ?? "Pi RPC command failed.",
              }),
            );
          return;
        }
      }
    }

    this.offer(parsed);
  }

  private offer(event: unknown): void {
    Effect.runFork(Queue.offer(this.queue, { event }).pipe(Effect.ignore));
  }
}

export const makePiRpcRuntime = (
  options: PiRpcRuntimeOptions,
): Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const queue = yield* Queue.unbounded<PiRpcRawEvent>();
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
    const runtime = new PiRpcProcessRuntime(child, queue);
    yield* Scope.addFinalizer(scope, runtime.close);
    return runtime;
  });

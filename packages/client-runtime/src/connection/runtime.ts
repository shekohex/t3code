import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { applyShellStreamEvent } from "../shellSnapshotReducer.ts";
import type { WsRpcProtocolClient } from "../wsRpcProtocol.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import { Connectivity } from "./connectivity.ts";
import { ConnectionDriver } from "./driver.ts";
import { connectionProjectionPhase } from "./model.ts";
import type { ConnectionAttemptError, ConnectionTarget } from "./model.ts";
import { makeEnvironmentCommands, type EnvironmentCommandsService } from "./commands.ts";
import { makeEnvironmentOperations, type EnvironmentOperationsService } from "./operations.ts";
import { EnvironmentCacheStore } from "./persistence.ts";
import { type EnvironmentSupervisorService, makeEnvironmentSupervisor } from "./supervisor.ts";
import { makeEnvironmentThreads, type EnvironmentThreadsService } from "./threads.ts";
import { ConnectionWakeups } from "./wakeups.ts";

export class EnvironmentRpcUnavailableError extends Schema.TaggedErrorClass<EnvironmentRpcUnavailableError>()(
  "EnvironmentRpcUnavailableError",
  {
    environmentId: Schema.String,
    message: Schema.String,
  },
) {}

export type EnvironmentRpcTag = keyof WsRpcProtocolClient & string;
type RpcTag = EnvironmentRpcTag;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
export type EnvironmentSubscriptionRpcTag =
  | typeof ORCHESTRATION_WS_METHODS.subscribeShell
  | typeof ORCHESTRATION_WS_METHODS.subscribeThread
  | typeof WS_METHODS.subscribeAuthAccess
  | typeof WS_METHODS.subscribeServerConfig
  | typeof WS_METHODS.subscribeServerLifecycle
  | typeof WS_METHODS.subscribeTerminalEvents
  | typeof WS_METHODS.subscribeTerminalMetadata
  | typeof WS_METHODS.subscribeVcsStatus
  | typeof WS_METHODS.terminalAttach;
export type EnvironmentStreamCommandRpcTag =
  | typeof WS_METHODS.cloudInstallRelayClient
  | typeof WS_METHODS.gitRunStackedAction;
export type EnvironmentStreamRpcTag =
  | EnvironmentSubscriptionRpcTag
  | EnvironmentStreamCommandRpcTag;
export type EnvironmentUnaryRpcTag = Exclude<RpcTag, EnvironmentStreamRpcTag>;

export type EnvironmentRpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];
export type EnvironmentRpcSuccess<TTag extends EnvironmentUnaryRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer A, any, any>
    ? A
    : never;
export type EnvironmentRpcFailure<TTag extends EnvironmentUnaryRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<any, infer E, any>
    ? E
    : never;
export type EnvironmentRpcStreamValue<TTag extends EnvironmentStreamRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer A, any, any>
    ? A
    : never;
export type EnvironmentRpcStreamFailure<TTag extends EnvironmentStreamRpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<any, infer E, any>
    ? E
    : never;

export interface EnvironmentRpcService {
  readonly config: Effect.Effect<
    ServerConfig,
    EnvironmentRpcUnavailableError | ConnectionAttemptError
  >;
  readonly request: <TTag extends EnvironmentUnaryRpcTag>(
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Effect.Effect<
    EnvironmentRpcSuccess<TTag>,
    EnvironmentRpcFailure<TTag> | EnvironmentRpcUnavailableError
  >;
  readonly runStream: <TTag extends EnvironmentStreamCommandRpcTag>(
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Stream.Stream<
    EnvironmentRpcStreamValue<TTag>,
    EnvironmentRpcStreamFailure<TTag> | EnvironmentRpcUnavailableError
  >;
  readonly subscribe: <TTag extends EnvironmentSubscriptionRpcTag>(
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Stream.Stream<EnvironmentRpcStreamValue<TTag>, EnvironmentRpcStreamFailure<TTag>>;
}

export class EnvironmentRpc extends Context.Service<EnvironmentRpc, EnvironmentRpcService>()(
  "@t3tools/client-runtime/connection/runtime/EnvironmentRpc",
) {}

export type EnvironmentShellStatus = "empty" | "cached" | "synchronizing" | "live";

export interface EnvironmentShellState {
  readonly snapshot: Option.Option<OrchestrationShellSnapshot>;
  readonly status: EnvironmentShellStatus;
  readonly error: Option.Option<string>;
}

export interface EnvironmentShellService {
  readonly state: SubscriptionRef.SubscriptionRef<EnvironmentShellState>;
}

export class EnvironmentShell extends Context.Service<EnvironmentShell, EnvironmentShellService>()(
  "@t3tools/client-runtime/connection/runtime/EnvironmentShell",
) {}

export interface EnvironmentRuntimeService {
  readonly target: ConnectionTarget;
  readonly supervisor: EnvironmentSupervisorService;
  readonly config: SubscriptionRef.SubscriptionRef<Option.Option<ServerConfig>>;
  readonly rpc: EnvironmentRpcService;
  readonly operations: EnvironmentOperationsService;
  readonly commands: EnvironmentCommandsService;
  readonly shell: EnvironmentShellService;
  readonly threads: EnvironmentThreadsService;
}

export class EnvironmentRuntime extends Context.Service<
  EnvironmentRuntime,
  EnvironmentRuntimeService
>()("@t3tools/client-runtime/connection/runtime/EnvironmentRuntime") {}

export interface EnvironmentRuntimeFactoryService {
  readonly make: (
    entry: ConnectionCatalogEntry,
  ) => Effect.Effect<EnvironmentRuntimeService, never, Scope.Scope>;
}

export class EnvironmentRuntimeFactory extends Context.Service<
  EnvironmentRuntimeFactory,
  EnvironmentRuntimeFactoryService
>()("@t3tools/client-runtime/connection/runtime/EnvironmentRuntimeFactory") {}

function shellStatusForSnapshot(
  snapshot: Option.Option<OrchestrationShellSnapshot>,
): EnvironmentShellStatus {
  return Option.isSome(snapshot) ? "cached" : "empty";
}

export const makeEnvironmentRpc = Effect.fn("EnvironmentRpc.make")((
  supervisor: EnvironmentSupervisorService,
) => {
  const currentSession = SubscriptionRef.get(supervisor.session).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new EnvironmentRpcUnavailableError({
              environmentId: supervisor.target.environmentId,
              message: `${supervisor.target.label} is not connected.`,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
  const request: EnvironmentRpcService["request"] = Effect.fn("EnvironmentRpc.request")(function* <
    TTag extends EnvironmentUnaryRpcTag,
  >(tag: TTag, input: EnvironmentRpcInput<TTag>) {
    yield* Effect.annotateCurrentSpan({ "rpc.method": tag });
    const session = yield* currentSession;
    const method = session.client[tag] as (
      input: EnvironmentRpcInput<TTag>,
    ) => Effect.Effect<EnvironmentRpcSuccess<TTag>, EnvironmentRpcFailure<TTag>>;
    return yield* method(input);
  });
  const runStream: EnvironmentRpcService["runStream"] = <
    TTag extends EnvironmentStreamCommandRpcTag,
  >(
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) =>
    Stream.unwrap(
      currentSession.pipe(
        Effect.map((session) => {
          const method = session.client[tag] as (
            input: EnvironmentRpcInput<TTag>,
          ) => Stream.Stream<EnvironmentRpcStreamValue<TTag>, EnvironmentRpcStreamFailure<TTag>>;
          return method(input);
        }),
      ),
    ).pipe(
      Stream.withSpan("EnvironmentRpc.runStream", {
        attributes: { "rpc.method": tag },
      }),
    );
  const subscribe: EnvironmentRpcService["subscribe"] = <
    TTag extends EnvironmentSubscriptionRpcTag,
  >(
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) =>
    SubscriptionRef.changes(supervisor.session).pipe(
      Stream.switchMap(
        Option.match({
          onNone: () => Stream.empty,
          onSome: (session) => {
            const method = session.client[tag] as (
              input: EnvironmentRpcInput<TTag>,
            ) => Stream.Stream<EnvironmentRpcStreamValue<TTag>, EnvironmentRpcStreamFailure<TTag>>;
            return method(input);
          },
        }),
      ),
      Stream.withSpan("EnvironmentRpc.subscribe", {
        attributes: { "rpc.method": tag },
      }),
    );
  const config = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(supervisor.session);
    if (Option.isNone(current)) {
      return yield* new EnvironmentRpcUnavailableError({
        environmentId: supervisor.target.environmentId,
        message: `${supervisor.target.label} is not connected.`,
      });
    }
    return yield* current.value.initialConfig;
  });

  return Effect.succeed(EnvironmentRpc.of({ config, request, runStream, subscribe }));
});

function formatShellError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize environment data.";
}

export const makeEnvironmentShell = Effect.fn("EnvironmentShell.make")(function* (
  supervisor: EnvironmentSupervisorService,
  rpc: EnvironmentRpcService,
  cache: EnvironmentCacheStore["Service"],
) {
  const cachedSnapshot = yield* cache.loadShell(supervisor.target.environmentId).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not load cached environment shell.").pipe(
        Effect.annotateLogs({
          environmentId: supervisor.target.environmentId,
          error: error.message,
        }),
        Effect.as(Option.none<OrchestrationShellSnapshot>()),
      ),
    ),
  );
  const state = yield* SubscriptionRef.make<EnvironmentShellState>({
    snapshot: cachedSnapshot,
    status: shellStatusForSnapshot(cachedSnapshot),
    error: Option.none(),
  });

  const setDisconnected = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: shellStatusForSnapshot(current.snapshot),
  }));
  const setSynchronizing = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: "synchronizing" as const,
    error: Option.none(),
  }));
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setStreamError = (error: unknown) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      status: shellStatusForSnapshot(current.snapshot),
      error: Option.some(formatShellError(error)),
    }));

  const applyItem = Effect.fn("EnvironmentShell.applyItem")(function* (
    item: OrchestrationShellStreamItem,
  ) {
    const current = yield* SubscriptionRef.get(state);
    const nextSnapshot =
      item.kind === "snapshot"
        ? item.snapshot
        : Option.match(current.snapshot, {
            onNone: () => null,
            onSome: (snapshot) =>
              item.sequence > snapshot.snapshotSequence
                ? applyShellStreamEvent(snapshot, item)
                : snapshot,
          });
    if (nextSnapshot === null) {
      return;
    }

    yield* cache.saveShell(supervisor.target.environmentId, nextSnapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not persist environment shell cache.").pipe(
          Effect.annotateLogs({
            environmentId: supervisor.target.environmentId,
            error: error.message,
          }),
        ),
      ),
    );
    yield* SubscriptionRef.set(state, {
      snapshot: Option.some(nextSnapshot),
      status: "live",
      error: Option.none(),
    });
  });

  yield* rpc.subscribe(ORCHESTRATION_WS_METHODS.subscribeShell, {}).pipe(
    Stream.runForEach(applyItem),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : setStreamError(Cause.squash(cause)),
    ),
    Effect.forkScoped,
  );
  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  return EnvironmentShell.of({ state });
});

const makeEnvironmentConfig = Effect.fn("EnvironmentConfig.make")(function* (
  supervisor: EnvironmentSupervisorService,
) {
  const state = yield* SubscriptionRef.make<Option.Option<ServerConfig>>(Option.none());

  yield* SubscriptionRef.changes(supervisor.session).pipe(
    Stream.runForEach(
      Option.match({
        onNone: () => SubscriptionRef.set(state, Option.none()),
        onSome: (session) =>
          session.initialConfig.pipe(
            Effect.flatMap((config) => SubscriptionRef.set(state, Option.some(config))),
          ),
      }),
    ),
    Effect.forkScoped,
  );

  return state;
});

export function environmentRuntimeLayer(
  entry: ConnectionCatalogEntry,
): Layer.Layer<
  EnvironmentRuntime,
  never,
  EnvironmentCacheStore | Connectivity | ConnectionWakeups | ConnectionDriver | Crypto.Crypto
> {
  return Layer.effect(EnvironmentRuntime, makeEnvironmentRuntime(entry));
}

export const makeEnvironmentRuntime = Effect.fn("EnvironmentRuntime.make")(function* (
  entry: ConnectionCatalogEntry,
) {
  const target = entry.target;
  const cache = yield* EnvironmentCacheStore;
  const supervisor = yield* makeEnvironmentSupervisor(entry, {
    initiallyDesired: false,
  });
  const rpc = yield* makeEnvironmentRpc(supervisor);
  const operations = yield* makeEnvironmentOperations(rpc);
  const commands = yield* makeEnvironmentCommands(operations);
  const shell = yield* makeEnvironmentShell(supervisor, rpc, cache);
  const threads = yield* makeEnvironmentThreads(supervisor, rpc);
  const config = yield* makeEnvironmentConfig(supervisor);
  return EnvironmentRuntime.of({
    target,
    supervisor,
    config,
    rpc,
    operations,
    commands,
    shell,
    threads,
  });
});

export const environmentRuntimeFactoryLayer = Layer.effect(
  EnvironmentRuntimeFactory,
  Effect.gen(function* () {
    const dependencies = yield* Effect.context<
      EnvironmentCacheStore | Connectivity | ConnectionWakeups | ConnectionDriver | Crypto.Crypto
    >();
    return EnvironmentRuntimeFactory.of({
      make: (entry) => makeEnvironmentRuntime(entry).pipe(Effect.provide(dependencies)),
    });
  }),
);

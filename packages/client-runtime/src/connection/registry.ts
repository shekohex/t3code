import type { EnvironmentId, ServerConfig, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { SshEnvironmentGateway } from "./capabilities.ts";
import {
  type ConnectionCatalogEntry,
  type ConnectionRegistration,
  ConnectionProfileStore,
  type PrimaryConnectionRegistration,
  SshConnectionProfile,
  connectionRegistrationCatalogEntry,
} from "./catalog.ts";
import { Connectivity } from "./connectivity.ts";
import type { NetworkStatus, PreparedConnection, SupervisorConnectionState } from "./model.ts";
import type { ConnectionAttemptError } from "./model.ts";
import {
  type ConnectionPersistenceError,
  ConnectionRegistrationStore,
  ConnectionTargetStore,
  EnvironmentCacheStore,
  EnvironmentOwnedDataCleanup,
} from "./persistence.ts";
import {
  type EnvironmentRpcFailure,
  type EnvironmentRpcInput,
  type EnvironmentRpcStreamFailure,
  type EnvironmentRpcStreamValue,
  type EnvironmentStreamCommandRpcTag,
  type EnvironmentSubscriptionRpcTag,
  type EnvironmentRpcUnavailableError,
  type EnvironmentUnaryRpcTag,
  EnvironmentRuntimeFactory,
  type EnvironmentRuntimeService,
  type EnvironmentRpcSuccess,
  type EnvironmentShellState,
} from "./runtime.ts";
import type { EnvironmentThreadState } from "./threads.ts";

const isSshConnectionProfile = Schema.is(SshConnectionProfile);

export class EnvironmentNotRegisteredError extends Schema.TaggedErrorClass<EnvironmentNotRegisteredError>()(
  "EnvironmentNotRegisteredError",
  {
    environmentId: Schema.String,
    message: Schema.String,
  },
) {}

export class PlatformEnvironmentRemovalError extends Schema.TaggedErrorClass<PlatformEnvironmentRemovalError>()(
  "PlatformEnvironmentRemovalError",
  {
    environmentId: Schema.String,
    message: Schema.String,
  },
) {}

export interface EnvironmentRegistryService {
  readonly entries: SubscriptionRef.SubscriptionRef<
    ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
  >;
  readonly networkStatus: SubscriptionRef.SubscriptionRef<NetworkStatus>;
  readonly start: Effect.Effect<void>;
  readonly register: (
    registration: ConnectionRegistration,
  ) => Effect.Effect<void, ConnectionPersistenceError>;
  readonly registerPlatform: (registration: PrimaryConnectionRegistration) => Effect.Effect<void>;
  readonly remove: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<
    void,
    | ConnectionPersistenceError
    | ConnectionAttemptError
    | EnvironmentNotRegisteredError
    | PlatformEnvironmentRemovalError
  >;
  readonly removeRelayEnvironments: () => Effect.Effect<
    void,
    ConnectionPersistenceError | ConnectionAttemptError | PlatformEnvironmentRemovalError
  >;
  readonly retryNow: (environmentId: EnvironmentId) => Effect.Effect<void>;
  readonly state: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<SupervisorConnectionState, EnvironmentNotRegisteredError>;
  readonly stateChanges: (
    environmentId: EnvironmentId,
  ) => Stream.Stream<SupervisorConnectionState, EnvironmentNotRegisteredError>;
  readonly rpcGenerationChanges: (
    environmentId: EnvironmentId,
  ) => Stream.Stream<number, EnvironmentNotRegisteredError>;
  readonly preparedConnectionChanges: (
    environmentId: EnvironmentId,
  ) => Stream.Stream<Option.Option<PreparedConnection>, EnvironmentNotRegisteredError>;
  readonly shellState: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<EnvironmentShellState, EnvironmentNotRegisteredError>;
  readonly shellStateChanges: (
    environmentId: EnvironmentId,
  ) => Stream.Stream<EnvironmentShellState, EnvironmentNotRegisteredError>;
  readonly configChanges: (
    environmentId: EnvironmentId,
  ) => Stream.Stream<Option.Option<ServerConfig>, EnvironmentNotRegisteredError>;
  readonly threadStateChanges: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ) => Stream.Stream<EnvironmentThreadState, EnvironmentNotRegisteredError>;
  readonly request: <TTag extends EnvironmentUnaryRpcTag>(
    environmentId: EnvironmentId,
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Effect.Effect<
    EnvironmentRpcSuccess<TTag>,
    EnvironmentRpcFailure<TTag> | EnvironmentNotRegisteredError | EnvironmentRpcUnavailableError
  >;
  readonly runStream: <TTag extends EnvironmentStreamCommandRpcTag>(
    environmentId: EnvironmentId,
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Stream.Stream<
    EnvironmentRpcStreamValue<TTag>,
    | EnvironmentRpcStreamFailure<TTag>
    | EnvironmentNotRegisteredError
    | EnvironmentRpcUnavailableError
  >;
  readonly subscribe: <TTag extends EnvironmentSubscriptionRpcTag>(
    environmentId: EnvironmentId,
    tag: TTag,
    input: EnvironmentRpcInput<TTag>,
  ) => Stream.Stream<
    EnvironmentRpcStreamValue<TTag>,
    EnvironmentRpcStreamFailure<TTag> | EnvironmentNotRegisteredError
  >;
  readonly withRuntime: <A, E>(
    environmentId: EnvironmentId,
    use: (runtime: EnvironmentRuntimeService) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | EnvironmentNotRegisteredError>;
}

export class EnvironmentRegistry extends Context.Service<
  EnvironmentRegistry,
  EnvironmentRegistryService
>()("@t3tools/client-runtime/connection/registry/EnvironmentRegistry") {}

interface EnvironmentRuntimeLease {
  readonly entry: ConnectionCatalogEntry;
  readonly runtime: EnvironmentRuntimeService;
  readonly scope: Scope.Closeable;
}

const makeEnvironmentRegistry = Effect.fn("EnvironmentRegistry.make")(function* () {
  const storage = yield* ConnectionTargetStore;
  const registrations = yield* ConnectionRegistrationStore;
  const cache = yield* EnvironmentCacheStore;
  const ownedDataCleanup = yield* EnvironmentOwnedDataCleanup;
  const profiles = yield* ConnectionProfileStore;
  const connectivity = yield* Connectivity;
  const ssh = yield* SshEnvironmentGateway;
  const runtimeFactory = yield* EnvironmentRuntimeFactory;
  const persistedTargets = yield* storage.list;
  const initialEntries = new Map(
    yield* Effect.forEach(
      persistedTargets,
      Effect.fn("EnvironmentRegistry.loadCatalogEntry")(function* (target) {
        const profile =
          target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget"
            ? yield* profiles.get(target.connectionId)
            : Option.none();
        return [
          target.environmentId,
          { target, profile } satisfies ConnectionCatalogEntry,
        ] as const;
      }),
      { concurrency: "unbounded" },
    ),
  );
  const entries =
    yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(initialEntries);
  const networkStatus = yield* SubscriptionRef.make(yield* connectivity.status);
  const leases = yield* Ref.make<ReadonlyMap<EnvironmentId, EnvironmentRuntimeLease>>(new Map());
  const platformEnvironmentIds = yield* Ref.make<ReadonlySet<EnvironmentId>>(new Set());
  const leaseLocks = yield* Ref.make<ReadonlyMap<EnvironmentId, Semaphore.Semaphore>>(new Map());
  const leaseLocksGuard = yield* Semaphore.make(1);
  const started = yield* Ref.make(false);

  const getLeaseLock = Effect.fn("EnvironmentRegistry.getLeaseLock")(function* (
    environmentId: EnvironmentId,
  ) {
    return yield* leaseLocksGuard.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(leaseLocks);
        const existing = current.get(environmentId);
        if (existing !== undefined) {
          return existing;
        }
        const created = yield* Semaphore.make(1);
        yield* Ref.set(leaseLocks, new Map(current).set(environmentId, created));
        return created;
      }),
    );
  });

  const getEntry = Effect.fn("EnvironmentRegistry.getEntry")(function* (
    environmentId: EnvironmentId,
  ) {
    const entry = (yield* SubscriptionRef.get(entries)).get(environmentId);
    if (entry === undefined) {
      return yield* new EnvironmentNotRegisteredError({
        environmentId,
        message: `Environment ${environmentId} is not registered.`,
      });
    }
    return entry;
  });

  const closeRuntimeLease = Effect.fn("EnvironmentRegistry.closeRuntimeLease")(function* (
    environmentId: EnvironmentId,
  ) {
    const current = yield* Ref.get(leases);
    const lease = current.get(environmentId);
    if (lease === undefined) {
      return;
    }
    const next = new Map(current);
    next.delete(environmentId);
    yield* Ref.set(leases, next);
    yield* Scope.close(lease.scope, Exit.void);
  });

  const createRuntimeLease = Effect.fn("EnvironmentRegistry.createRuntimeLease")(function* (
    entry: ConnectionCatalogEntry,
  ) {
    const environmentId = entry.target.environmentId;
    const scope = yield* Scope.make();
    const runtime = yield* runtimeFactory.make(entry).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    yield* Ref.update(leases, (current) => {
      const next = new Map(current);
      next.set(environmentId, { entry, runtime, scope });
      return next;
    });
    yield* runtime.supervisor.connect;
    return runtime;
  });

  const acquireRuntime = Effect.fn("EnvironmentRegistry.acquireRuntime")(function* (
    environmentId: EnvironmentId,
  ) {
    const leaseLock = yield* getLeaseLock(environmentId);
    return yield* leaseLock.withPermits(1)(
      Effect.gen(function* () {
        const entry = yield* getEntry(environmentId);
        const existing = (yield* Ref.get(leases)).get(environmentId);
        if (existing !== undefined) {
          if (Equal.equals(existing.entry, entry)) {
            return existing.runtime;
          }
          yield* closeRuntimeLease(environmentId);
        }
        return yield* createRuntimeLease(entry);
      }),
    );
  });

  const withRuntime: EnvironmentRegistryService["withRuntime"] = Effect.fn(
    "EnvironmentRegistry.withRuntime",
  )(function* (environmentId, use) {
    return yield* use(yield* acquireRuntime(environmentId));
  });

  const start = Effect.gen(function* () {
    if (yield* Ref.getAndSet(started, true)) {
      return;
    }
    yield* Effect.forEach(
      persistedTargets,
      (target) =>
        acquireRuntime(target.environmentId).pipe(
          Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
        ),
      {
        concurrency: "unbounded",
        discard: true,
      },
    );
  }).pipe(Effect.withSpan("EnvironmentRegistry.start"));

  const installEntry = Effect.fn("EnvironmentRegistry.installEntry")(function* (
    entry: ConnectionCatalogEntry,
    options?: { readonly retainEquivalentRuntime?: boolean },
  ) {
    const target = entry.target;
    const leaseLock = yield* getLeaseLock(target.environmentId);
    yield* leaseLock.withPermits(1)(
      Effect.gen(function* () {
        const previous = (yield* SubscriptionRef.get(entries)).get(target.environmentId);
        const existingLease = (yield* Ref.get(leases)).get(target.environmentId);
        if (
          options?.retainEquivalentRuntime === true &&
          previous !== undefined &&
          Equal.equals(previous, entry) &&
          existingLease !== undefined &&
          Equal.equals(existingLease.entry, entry)
        ) {
          return;
        }

        yield* closeRuntimeLease(target.environmentId);
        yield* SubscriptionRef.update(entries, (current) => {
          const next = new Map(current);
          next.set(target.environmentId, entry);
          return next;
        });
        yield* createRuntimeLease(entry);
      }),
    );
  });

  const register = Effect.fn("EnvironmentRegistry.register")(function* (
    registration: ConnectionRegistration,
  ) {
    yield* registrations.register(registration);
    yield* installEntry(connectionRegistrationCatalogEntry(registration));
  });

  const registerPlatform = Effect.fn("EnvironmentRegistry.registerPlatform")(function* (
    registration: PrimaryConnectionRegistration,
  ) {
    const entry = connectionRegistrationCatalogEntry(registration);
    const target = entry.target;
    yield* Ref.update(platformEnvironmentIds, (current) => {
      const next = new Set(current);
      next.add(target.environmentId);
      return next;
    });
    yield* installEntry(entry, { retainEquivalentRuntime: true });
  });

  const remove = Effect.fn("EnvironmentRegistry.remove")(function* (environmentId: EnvironmentId) {
    if ((yield* Ref.get(platformEnvironmentIds)).has(environmentId)) {
      return yield* new PlatformEnvironmentRemovalError({
        environmentId,
        message: "Platform-managed environments cannot be removed.",
      });
    }
    const leaseLock = yield* getLeaseLock(environmentId);
    return yield* leaseLock.withPermits(1)(
      Effect.gen(function* () {
        const target = (yield* getEntry(environmentId)).target;
        const profile =
          target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget"
            ? yield* profiles.get(target.connectionId)
            : Option.none();

        yield* closeRuntimeLease(environmentId);

        if (
          target._tag === "SshConnectionTarget" &&
          Option.isSome(profile) &&
          isSshConnectionProfile(profile.value)
        ) {
          yield* ssh.disconnect(profile.value.target).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not disconnect the managed SSH environment.", {
                environmentId,
                error,
              }),
            ),
            Effect.ignore,
          );
        }

        yield* Effect.all(
          [
            registrations.remove(target),
            cache.clear(environmentId),
            ownedDataCleanup.clear(environmentId),
          ],
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
        yield* SubscriptionRef.update(entries, (current) => {
          const next = new Map(current);
          next.delete(environmentId);
          return next;
        });
      }),
    );
  });

  const removeRelayEnvironments = Effect.fn("EnvironmentRegistry.removeRelayEnvironments")(
    function* () {
      const relayEnvironmentIds = [...(yield* SubscriptionRef.get(entries)).values()]
        .filter((entry) => entry.target._tag === "RelayConnectionTarget")
        .map((entry) => entry.target.environmentId);

      yield* Effect.forEach(
        relayEnvironmentIds,
        (environmentId) =>
          remove(environmentId).pipe(
            Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
          ),
        {
          concurrency: "unbounded",
          discard: true,
        },
      );
    },
  );

  const retryNow = (environmentId: EnvironmentId) =>
    withRuntime(environmentId, (runtime) => runtime.supervisor.retryNow).pipe(
      Effect.catchTag("EnvironmentNotRegisteredError", () => Effect.void),
    );
  const state = (environmentId: EnvironmentId) =>
    withRuntime(environmentId, (runtime) => SubscriptionRef.get(runtime.supervisor.state));
  const stateChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return SubscriptionRef.changes(runtime.supervisor.state);
      }),
    );
  const rpcGenerationChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return Stream.concat(
          Stream.fromEffect(SubscriptionRef.get(runtime.supervisor.state)),
          SubscriptionRef.changes(runtime.supervisor.state),
        ).pipe(
          Stream.filterMap((state) =>
            state.phase === "connected" ? Result.succeed(state.generation) : Result.failVoid,
          ),
          Stream.changes,
        );
      }),
    );
  const preparedConnectionChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return SubscriptionRef.changes(runtime.supervisor.prepared);
      }),
    );
  const shellState = (environmentId: EnvironmentId) =>
    withRuntime(environmentId, (runtime) => SubscriptionRef.get(runtime.shell.state));
  const shellStateChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return SubscriptionRef.changes(runtime.shell.state);
      }),
    );
  const configChanges = (environmentId: EnvironmentId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return SubscriptionRef.changes(runtime.config);
      }),
    );
  const threadStateChanges = (environmentId: EnvironmentId, threadId: ThreadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return runtime.threads.changes(threadId);
      }),
    );
  const request: EnvironmentRegistryService["request"] = (environmentId, tag, input) =>
    withRuntime(environmentId, (runtime) => runtime.rpc.request(tag, input));
  const runStream: EnvironmentRegistryService["runStream"] = (environmentId, tag, input) =>
    Stream.unwrap(
      withRuntime(environmentId, (runtime) => Effect.succeed(runtime.rpc.runStream(tag, input))),
    );
  const subscribe: EnvironmentRegistryService["subscribe"] = (environmentId, tag, input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const runtime = yield* acquireRuntime(environmentId);
        return runtime.rpc.subscribe(tag, input);
      }),
    );

  yield* Effect.addFinalizer(() =>
    Ref.get(leases).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(current.values(), (lease) => Scope.close(lease.scope, Exit.void), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    ),
  );
  yield* connectivity.changes.pipe(
    Stream.runForEach((status) => SubscriptionRef.set(networkStatus, status)),
    Effect.forkScoped,
  );

  return EnvironmentRegistry.of({
    entries,
    networkStatus,
    start,
    register,
    registerPlatform,
    remove,
    removeRelayEnvironments,
    retryNow,
    state,
    stateChanges,
    rpcGenerationChanges,
    preparedConnectionChanges,
    shellState,
    shellStateChanges,
    configChanges,
    threadStateChanges,
    request,
    runStream,
    subscribe,
    withRuntime,
  });
});

export const environmentRegistryLayer = Layer.effect(
  EnvironmentRegistry,
  makeEnvironmentRegistry(),
);

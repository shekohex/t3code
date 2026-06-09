import {
  EnvironmentId,
  ThreadId,
  type EnvironmentId as EnvironmentIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import { AVAILABLE_CONNECTION_STATE, type PreparedConnection } from "./model.ts";
import type { EnvironmentOperationsService } from "./operations.ts";
import { presentEnvironmentConnection, type EnvironmentPresentation } from "./presentation.ts";
import { projectEnvironmentCatalog } from "./readModel.ts";
import {
  EnvironmentNotRegisteredError,
  EnvironmentRegistry,
  type EnvironmentRegistryService,
} from "./registry.ts";
import {
  EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
  RelayEnvironmentDiscovery,
} from "./relayDiscovery.ts";
import type { EnvironmentShellState } from "./runtime.ts";
import type { EnvironmentRuntimeService } from "./runtime.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "./threads.ts";

const EMPTY_SHELL_STATE: EnvironmentShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

export interface EnvironmentCatalogState {
  readonly isReady: boolean;
  readonly entries: ReadonlyMap<EnvironmentIdType, ConnectionCatalogEntry>;
}

export const EMPTY_ENVIRONMENT_CATALOG_STATE: EnvironmentCatalogState = Object.freeze({
  isReady: false,
  entries: new Map(),
});

function threadAtomKey(environmentId: EnvironmentIdType, threadId: ThreadIdType): string {
  return `${environmentId}\u0000${threadId}`;
}

function parseThreadAtomKey(key: string): {
  readonly environmentId: EnvironmentIdType;
  readonly threadId: ThreadIdType;
} {
  const separator = key.indexOf("\u0000");
  if (separator < 0) {
    throw new Error("Invalid environment thread atom key.");
  }
  return {
    environmentId: EnvironmentId.make(key.slice(0, separator)),
    threadId: ThreadId.make(key.slice(separator + 1)),
  };
}

export interface EnvironmentOperationTarget<Input> {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}

interface EnvironmentOperationAtomOptions<Input, A, E> {
  readonly label: string;
  readonly execute: (
    operations: EnvironmentOperationsService,
    input: Input,
    runtime: EnvironmentRuntimeService,
  ) => Effect.Effect<A, E>;
}

interface EnvironmentQueryAtomOptions<Input, A, E> extends EnvironmentOperationAtomOptions<
  Input,
  A,
  E
> {
  readonly staleTimeMs?: number;
  readonly idleTtlMs?: number;
}

interface EnvironmentSubscriptionAtomOptions<Input, A, E> {
  readonly label: string;
  readonly subscribe: (
    operations: EnvironmentOperationsService,
    input: Input,
  ) => Stream.Stream<A, E>;
  readonly idleTtlMs?: number;
}

function environmentOperationKey<Input>(target: EnvironmentOperationTarget<Input>): string {
  return JSON.stringify([target.environmentId, target.input]);
}

function parseEnvironmentOperationKey<Input>(key: string): EnvironmentOperationTarget<Input> {
  const decoded = JSON.parse(key) as [EnvironmentIdType, Input];
  return {
    environmentId: EnvironmentId.make(decoded[0]),
    input: decoded[1],
  };
}

function withEnvironmentOperations<A, E>(
  environmentId: EnvironmentIdType,
  use: (
    operations: EnvironmentOperationsService,
    runtime: EnvironmentRuntimeService,
  ) => Effect.Effect<A, E>,
) {
  return EnvironmentRegistry.pipe(
    Effect.flatMap((registry) =>
      registry.withRuntime(environmentId, (environmentRuntime) =>
        use(environmentRuntime.operations, environmentRuntime),
      ),
    ),
  );
}

export function createEnvironmentQueryAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentQueryAtomOptions<Input, A, E>,
): (
  target: EnvironmentOperationTarget<Input>,
) => Atom.Atom<AsyncResult.AsyncResult<A, E | ER | Error>> {
  const rpcGenerationAtom = Atom.family((environmentId: EnvironmentIdType) =>
    runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(
          Effect.map((registry) =>
            registry
              .rpcGenerationChanges(environmentId)
              .pipe(Stream.map<number, number | null>((generation) => generation)),
          ),
        ),
      ),
      { initialValue: null },
    ),
  );
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentOperationKey<Input>(key);
    return runtime
      .atom((get) => {
        const generation = Option.getOrNull(
          AsyncResult.value(get(rpcGenerationAtom(target.environmentId))),
        );
        if (generation === null) {
          return Effect.never;
        }
        return withEnvironmentOperations(target.environmentId, (operations, environmentRuntime) =>
          options.execute(operations, target.input, environmentRuntime),
        );
      })
      .pipe(
        Atom.swr({
          staleTime: options.staleTimeMs ?? 30_000,
          revalidateOnMount: true,
        }),
        Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
        Atom.withLabel(`${options.label}:${key}`),
      );
  });
  return (target) => family(environmentOperationKey(target));
}

export function createEnvironmentSubscriptionAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentSubscriptionAtomOptions<Input, A, E>,
) {
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentOperationKey<Input>(key);
    return runtime
      .atom(
        Stream.unwrap(
          withEnvironmentOperations(target.environmentId, (operations) =>
            Effect.succeed(options.subscribe(operations, target.input)),
          ),
        ),
      )
      .pipe(
        Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
        Atom.withLabel(`${options.label}:${key}`),
      );
  });
  return (target: EnvironmentOperationTarget<Input>) => family(environmentOperationKey(target));
}

export function createEnvironmentMutation<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentOperationAtomOptions<Input, A, E>,
) {
  return runtime
    .fn<EnvironmentOperationTarget<Input>>()((target) =>
      withEnvironmentOperations(target.environmentId, (operations, environmentRuntime) =>
        options.execute(operations, target.input, environmentRuntime),
      ),
    )
    .pipe(Atom.withLabel(options.label));
}

export function createEnvironmentStreamMutation<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly execute: (
      operations: EnvironmentOperationsService,
      input: Input,
    ) => Stream.Stream<A, E>;
  },
) {
  return runtime
    .fn<EnvironmentOperationTarget<Input>>()<E | EnvironmentNotRegisteredError, A>((target) =>
      Stream.unwrap(
        withEnvironmentOperations(target.environmentId, (operations) =>
          Effect.succeed(options.execute(operations, target.input)),
        ),
      ).pipe(Stream.withSpan(options.label)),
    )
    .pipe(Atom.withLabel(options.label));
}

export function createEnvironmentConnectionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const catalogAtom = runtime.atom(
    Stream.unwrap(
      EnvironmentRegistry.pipe(
        Effect.map((registry) =>
          SubscriptionRef.changes(registry.entries).pipe(
            Stream.map((entries) => ({
              isReady: true,
              entries,
            })),
          ),
        ),
      ),
    ),
    {
      initialValue: EMPTY_ENVIRONMENT_CATALOG_STATE,
    },
  );
  const networkStatusAtom = runtime.atom(
    Stream.unwrap(
      EnvironmentRegistry.pipe(
        Effect.map((registry) => SubscriptionRef.changes(registry.networkStatus)),
      ),
    ),
    { initialValue: "unknown" as const },
  );
  const stateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(Effect.map((registry) => registry.stateChanges(environmentId))),
      ),
      { initialValue: AVAILABLE_CONNECTION_STATE },
    ),
  );
  const shellStateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(
          Effect.map((registry) => registry.shellStateChanges(environmentId)),
        ),
      ),
      { initialValue: EMPTY_SHELL_STATE },
    ),
  );
  const configAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(Effect.map((registry) => registry.configChanges(environmentId))),
      ),
      { initialValue: Option.none() },
    ),
  );
  const preparedConnectionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(
          Effect.map((registry) => registry.preparedConnectionChanges(environmentId)),
        ),
      ),
      { initialValue: Option.none<PreparedConnection>() },
    ),
  );
  const preparedConnectionValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(preparedConnectionAtom(environmentId))), () =>
        Option.none<PreparedConnection>(),
      ),
    ).pipe(Atom.withLabel(`environment-prepared-connection:${environmentId}`)),
  );
  const threadStateFamily = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadAtomKey(key);
    return runtime.atom(
      Stream.unwrap(
        EnvironmentRegistry.pipe(
          Effect.map((registry) => registry.threadStateChanges(environmentId, threadId)),
        ),
      ),
      { initialValue: EMPTY_ENVIRONMENT_THREAD_STATE },
    );
  });
  const threadStateAtom = (environmentId: EnvironmentIdType, threadId: ThreadIdType) =>
    threadStateFamily(threadAtomKey(environmentId, threadId));
  const register = runtime.fn((target: Parameters<EnvironmentRegistryService["register"]>[0]) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.register(target))),
  );
  const remove = runtime.fn((environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.remove(environmentId))),
  );
  const removeRelayEnvironments = runtime.fn(() =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.removeRelayEnvironments())),
  );
  const retryNow = runtime.fn((environmentId: EnvironmentId) =>
    EnvironmentRegistry.pipe(Effect.flatMap((registry) => registry.retryNow(environmentId))),
  );
  const catalogValueAtom = Atom.make((get) =>
    Option.getOrElse(AsyncResult.value(get(catalogAtom)), () => EMPTY_ENVIRONMENT_CATALOG_STATE),
  ).pipe(Atom.withLabel("environment-catalog-value"));
  const networkStatusValueAtom = Atom.make((get) =>
    Option.getOrElse(AsyncResult.value(get(networkStatusAtom)), () => "unknown" as const),
  ).pipe(Atom.withLabel("environment-network-status-value"));
  const presentationAtom = Atom.family((environmentId: EnvironmentIdType) =>
    Atom.make((get) => {
      const entry = get(catalogValueAtom).entries.get(environmentId);
      if (entry === undefined) {
        return null;
      }
      const state = Option.getOrElse(
        AsyncResult.value(get(stateAtom(environmentId))),
        () => AVAILABLE_CONNECTION_STATE,
      );
      const config = Option.getOrElse(AsyncResult.value(get(configAtom(environmentId))), () =>
        Option.none(),
      );
      return {
        entry,
        connection: presentEnvironmentConnection(state),
        serverConfig: Option.getOrNull(config),
      } satisfies EnvironmentPresentation;
    }).pipe(Atom.withLabel(`environment-presentation:${environmentId}`)),
  );
  const presentationsAtom = Atom.make((get) => {
    const catalog = get(catalogValueAtom);
    const presentations = new Map<EnvironmentIdType, EnvironmentPresentation>();
    for (const environmentId of catalog.entries.keys()) {
      const presentation = get(presentationAtom(environmentId));
      if (presentation !== null) {
        presentations.set(environmentId, presentation);
      }
    }
    return presentations as ReadonlyMap<EnvironmentIdType, EnvironmentPresentation>;
  }).pipe(Atom.withLabel("environment-presentations"));
  const shellStatesAtom = Atom.make((get) => {
    const catalog = get(catalogValueAtom);
    const states = new Map<EnvironmentIdType, EnvironmentShellState>();
    for (const environmentId of catalog.entries.keys()) {
      states.set(
        environmentId,
        Option.getOrElse(
          AsyncResult.value(get(shellStateAtom(environmentId))),
          () => EMPTY_SHELL_STATE,
        ),
      );
    }
    return states as ReadonlyMap<EnvironmentIdType, EnvironmentShellState>;
  }).pipe(Atom.withLabel("environment-shell-states"));
  const catalogReadModelAtom = Atom.make((get) =>
    projectEnvironmentCatalog(get(presentationsAtom), get(shellStatesAtom)),
  ).pipe(Atom.withLabel("environment-catalog-read-model"));

  return {
    catalogAtom,
    catalogValueAtom,
    networkStatusAtom,
    networkStatusValueAtom,
    presentationAtom,
    presentationsAtom,
    stateAtom,
    preparedConnectionAtom,
    preparedConnectionValueAtom,
    configAtom,
    shellStateAtom,
    shellStatesAtom,
    catalogReadModelAtom,
    threadStateAtom,
    register,
    remove,
    removeRelayEnvironments,
    retryNow,
  };
}

export function createRelayEnvironmentDiscoveryAtoms<R, E>(
  runtime: Atom.AtomRuntime<RelayEnvironmentDiscovery | R, E>,
) {
  const stateAtom = runtime.atom(
    Stream.unwrap(
      RelayEnvironmentDiscovery.pipe(
        Effect.map((discovery) => SubscriptionRef.changes(discovery.state)),
      ),
    ),
    {
      initialValue: EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
    },
  );
  const refresh = runtime.fn(() =>
    RelayEnvironmentDiscovery.pipe(Effect.flatMap((discovery) => discovery.refresh)),
  );
  const stateValueAtom = Atom.make((get) =>
    Option.getOrElse(
      AsyncResult.value(get(stateAtom)),
      () => EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
    ),
  ).pipe(Atom.withLabel("relay-environment-discovery-value"));

  return {
    stateAtom,
    stateValueAtom,
    refresh,
  };
}

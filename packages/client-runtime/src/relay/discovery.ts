import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@t3tools/contracts/relay";
import {
  RelayEnvironmentConnectScope,
  RelayEnvironmentStatusScope,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ManagedRelayClient } from "./managedRelay.ts";
import { CloudSession } from "../platform/capabilities.ts";
import { Connectivity } from "../connection/connectivity.ts";
import { mapManagedRelayError } from "../connection/errors.ts";
import { ConnectionBlockedError, type ConnectionAttemptError } from "../connection/model.ts";

export type RelayEnvironmentAvailability = "checking" | "online" | "offline" | "error";

export interface RelayDiscoveredEnvironment {
  readonly environment: RelayClientEnvironmentRecord;
  readonly availability: RelayEnvironmentAvailability;
  readonly status: Option.Option<RelayEnvironmentStatusResponse>;
  readonly error: Option.Option<ConnectionAttemptError>;
}

export interface RelayEnvironmentDiscoveryState {
  readonly environments: ReadonlyMap<string, RelayDiscoveredEnvironment>;
  readonly refreshing: boolean;
  readonly offline: boolean;
  readonly error: Option.Option<ConnectionAttemptError>;
}

export interface RelayEnvironmentDiscoveryService {
  readonly state: SubscriptionRef.SubscriptionRef<RelayEnvironmentDiscoveryState>;
  readonly refresh: Effect.Effect<void>;
}

export class RelayEnvironmentDiscovery extends Context.Service<
  RelayEnvironmentDiscovery,
  RelayEnvironmentDiscoveryService
>()("@t3tools/client-runtime/relay/discovery/RelayEnvironmentDiscovery") {}

export const EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE: RelayEnvironmentDiscoveryState = {
  environments: new Map(),
  refreshing: false,
  offline: false,
  error: Option.none(),
};

function validateStatus(
  environment: RelayClientEnvironmentRecord,
  status: RelayEnvironmentStatusResponse,
): Effect.Effect<RelayEnvironmentStatusResponse, ConnectionAttemptError> {
  if (status.environmentId !== environment.environmentId) {
    return Effect.fail(
      new ConnectionBlockedError({
        reason: "configuration",
        message: "Relay returned status for a different environment.",
      }),
    );
  }
  if (
    status.endpoint.httpBaseUrl !== environment.endpoint.httpBaseUrl ||
    status.endpoint.wsBaseUrl !== environment.endpoint.wsBaseUrl ||
    status.endpoint.providerKind !== environment.endpoint.providerKind
  ) {
    return Effect.fail(
      new ConnectionBlockedError({
        reason: "configuration",
        message: "Relay returned status for a different environment endpoint.",
      }),
    );
  }
  if (
    status.descriptor !== undefined &&
    status.descriptor.environmentId !== environment.environmentId
  ) {
    return Effect.fail(
      new ConnectionBlockedError({
        reason: "configuration",
        message: "Relay returned a descriptor for a different environment.",
      }),
    );
  }
  return Effect.succeed(status);
}

const makeRelayEnvironmentDiscovery = Effect.fn("RelayEnvironmentDiscovery.make")(function* () {
  const relay = yield* ManagedRelayClient;
  const session = yield* CloudSession;
  const connectivity = yield* Connectivity;
  const state = yield* SubscriptionRef.make(EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE);
  const refreshLock = yield* Semaphore.make(1);
  const hasRefreshed = yield* Ref.make(false);

  const updateEnvironment = Effect.fn("RelayEnvironmentDiscovery.updateEnvironment")(function* (
    environmentId: string,
    update: (current: RelayDiscoveredEnvironment) => RelayDiscoveredEnvironment,
  ) {
    yield* SubscriptionRef.update(state, (current) => {
      const entry = current.environments.get(environmentId);
      if (entry === undefined) {
        return current;
      }
      const environments = new Map(current.environments);
      environments.set(environmentId, update(entry));
      return { ...current, environments };
    });
  });

  const refreshStatus = Effect.fn("RelayEnvironmentDiscovery.refreshStatus")(function* (
    clerkToken: string,
    environment: RelayClientEnvironmentRecord,
  ) {
    const result = yield* relay
      .getEnvironmentStatus({
        clerkToken,
        scopes: [RelayEnvironmentStatusScope, RelayEnvironmentConnectScope],
        environmentId: environment.environmentId,
      })
      .pipe(
        Effect.mapError(mapManagedRelayError),
        Effect.flatMap((status) => validateStatus(environment, status)),
        Effect.result,
      );

    if (result._tag === "Success") {
      yield* updateEnvironment(environment.environmentId, (current) => ({
        ...current,
        availability: result.success.status,
        status: Option.some(result.success),
        error: Option.none(),
      }));
      return;
    }

    yield* updateEnvironment(environment.environmentId, (current) => ({
      ...current,
      availability: "error",
      error: Option.some(result.failure),
    }));
  });

  const refresh = refreshLock.withPermits(1)(
    Effect.gen(function* () {
      yield* Ref.set(hasRefreshed, true);
      if ((yield* connectivity.status) === "offline") {
        yield* SubscriptionRef.update(state, (current) => ({
          ...current,
          refreshing: false,
          offline: true,
        }));
        return;
      }

      yield* SubscriptionRef.update(state, (current) => ({
        ...current,
        refreshing: true,
        offline: false,
        error: Option.none(),
      }));

      const clerkToken = yield* session.clerkToken;
      const environments = yield* relay
        .listEnvironments({ clerkToken })
        .pipe(Effect.mapError(mapManagedRelayError));
      const previous = (yield* SubscriptionRef.get(state)).environments;
      const next = new Map<string, RelayDiscoveredEnvironment>();
      for (const environment of environments) {
        const existing = previous.get(environment.environmentId);
        next.set(environment.environmentId, {
          environment,
          availability: "checking",
          status: existing?.status ?? Option.none(),
          error: Option.none(),
        });
      }
      yield* SubscriptionRef.update(state, (current) => ({
        ...current,
        environments: next,
      }));

      yield* Effect.forEach(environments, (environment) => refreshStatus(clerkToken, environment), {
        concurrency: "unbounded",
        discard: true,
      });
      yield* SubscriptionRef.update(state, (current) => ({
        ...current,
        refreshing: false,
      }));
    }).pipe(
      Effect.catch((error) =>
        SubscriptionRef.update(state, (current) => ({
          ...current,
          refreshing: false,
          error: Option.some(error),
        })),
      ),
    ),
  );

  yield* connectivity.changes.pipe(
    Stream.changes,
    Stream.runForEach((networkStatus) =>
      networkStatus === "offline"
        ? SubscriptionRef.update(state, (current) => ({
            ...current,
            refreshing: false,
            offline: true,
          }))
        : Ref.get(hasRefreshed).pipe(
            Effect.flatMap((shouldRefresh) => (shouldRefresh ? refresh : Effect.void)),
          ),
    ),
    Effect.forkScoped,
  );

  return RelayEnvironmentDiscovery.of({ state, refresh });
});

export const relayEnvironmentDiscoveryLayer = Layer.effect(
  RelayEnvironmentDiscovery,
  makeRelayEnvironmentDiscovery(),
);

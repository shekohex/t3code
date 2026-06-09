import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
  RelayEnvironmentDiscovery,
} from "../relay/discovery.ts";

export function createRelayEnvironmentDiscoveryAtoms<R, E>(
  runtime: Atom.AtomRuntime<RelayEnvironmentDiscovery | R, E>,
) {
  const stateAtom = runtime.atom(
    Stream.unwrap(
      RelayEnvironmentDiscovery.pipe(
        Effect.map((discovery) => SubscriptionRef.changes(discovery.state)),
      ),
    ),
    { initialValue: EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE },
  );
  const stateValueAtom = Atom.make((get) =>
    Option.getOrElse(
      AsyncResult.value(get(stateAtom)),
      () => EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
    ),
  ).pipe(Atom.withLabel("relay-environment-discovery-value"));
  const refresh = runtime.fn(() =>
    RelayEnvironmentDiscovery.pipe(Effect.flatMap((discovery) => discovery.refresh)),
  );

  return {
    stateAtom,
    stateValueAtom,
    refresh,
  };
}

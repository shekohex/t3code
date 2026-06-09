import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  type EnvironmentPresentation as BaseEnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import { useCallback, useMemo } from "react";

import {
  connectPairing as connectPairingAtom,
  connectSshEnvironment as connectSshEnvironmentAtom,
  environmentCatalog,
  environmentPresentations,
  relayEnvironmentDiscovery,
} from "./connectionRuntime";
import { useEnvironmentConnectionActions, usePreparedConnection } from "./connectionState";

export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

export function useEnvironments() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const networkStatus = useAtomValue(environmentCatalog.networkStatusValueAtom);
  const presentationById = useAtomValue(environmentPresentations.presentationsAtom);

  const environments = useMemo(
    () =>
      [...presentationById.entries()].map(
        ([environmentId, presentation]) =>
          ({
            ...presentation,
            environmentId,
            label: presentation.entry.target.label,
            displayUrl: connectionCatalogDisplayUrl(presentation.entry),
            relayManaged: presentation.entry.target._tag === "RelayConnectionTarget",
          }) satisfies EnvironmentPresentation,
      ),
    [presentationById],
  );

  return {
    isReady: catalog.isReady,
    networkStatus,
    environments,
    presentationById,
  };
}

export function usePrimaryEnvironment(): EnvironmentPresentation | null {
  const { environments } = useEnvironments();
  return useMemo(
    () =>
      environments.find(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      ) ?? null,
    [environments],
  );
}

export function useEnvironmentHttpBaseUrl(environmentId: EnvironmentId | null): string | null {
  const prepared = usePreparedConnection(environmentId);
  return Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

export function useRelayEnvironmentDiscovery() {
  return useAtomValue(relayEnvironmentDiscovery.stateValueAtom);
}

export function useEnvironmentActions() {
  const { register, remove, retryNow } = useEnvironmentConnectionActions();
  const connectPairing = useAtomSet(connectPairingAtom, {
    mode: "promise",
  });
  const connectSshEnvironment = useAtomSet(connectSshEnvironmentAtom, {
    mode: "promise",
  });
  const refreshRelayEnvironments = useAtomSet(relayEnvironmentDiscovery.refresh, {
    mode: "promise",
  });

  const connectRelayEnvironment = useCallback(
    (environment: RelayClientEnvironmentRecord) =>
      register(
        new RelayConnectionRegistration({
          target: new RelayConnectionTarget({
            environmentId: environment.environmentId,
            label: environment.label,
          }),
        }),
      ),
    [register],
  );

  return {
    connectPairing,
    connectSshEnvironment,
    connectRelayEnvironment,
    removeEnvironment: remove,
    retryEnvironment: retryNow,
    refreshRelayEnvironments,
  };
}

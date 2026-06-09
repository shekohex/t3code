import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  RelayConnectionRegistration,
  RelayConnectionTarget,
  type EnvironmentPresentation,
  type EnvironmentShellState,
} from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import { useCallback, useMemo } from "react";

import {
  connectWebPairing,
  connectWebSshEnvironment,
  webEnvironmentConnections,
  webRelayEnvironmentDiscovery,
} from "./webConnectionRuntime";
import { useWebEnvironmentConnectionActions, useWebPreparedConnection } from "./webConnectionState";

export interface WebEnvironmentPresentation extends EnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

export function useWebEnvironments() {
  const catalog = useAtomValue(webEnvironmentConnections.catalogValueAtom);
  const networkStatus = useAtomValue(webEnvironmentConnections.networkStatusValueAtom);
  const presentationById = useAtomValue(webEnvironmentConnections.presentationsAtom);
  const shellStateById = useAtomValue(webEnvironmentConnections.shellStatesAtom);

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
          }) satisfies WebEnvironmentPresentation,
      ),
    [presentationById],
  );

  return {
    isReady: catalog.isReady,
    networkStatus,
    environments,
    presentationById,
    shellStateById: shellStateById as ReadonlyMap<EnvironmentId, EnvironmentShellState>,
  };
}

export function useWebPrimaryEnvironment(): WebEnvironmentPresentation | null {
  const { environments } = useWebEnvironments();
  return useMemo(
    () =>
      environments.find(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      ) ?? null,
    [environments],
  );
}

export function useWebEnvironmentHttpBaseUrl(environmentId: EnvironmentId): string | null {
  const prepared = useWebPreparedConnection(environmentId);
  return Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

export function useWebRelayEnvironmentDiscovery() {
  return useAtomValue(webRelayEnvironmentDiscovery.stateValueAtom);
}

export function useWebEnvironmentActions() {
  const { register, remove, retryNow } = useWebEnvironmentConnectionActions();
  const connectPairing = useAtomSet(connectWebPairing, {
    mode: "promise",
  });
  const connectSshEnvironment = useAtomSet(connectWebSshEnvironment, {
    mode: "promise",
  });
  const refreshRelayEnvironments = useAtomSet(webRelayEnvironmentDiscovery.refresh, {
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

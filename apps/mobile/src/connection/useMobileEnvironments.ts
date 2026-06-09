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
import { useCallback, useMemo } from "react";

import {
  connectMobilePairingUrl,
  mobileEnvironmentConnections,
  mobileRelayEnvironmentDiscovery,
} from "./mobileConnectionRuntime";
import { useMobileEnvironmentConnectionActions } from "./mobileConnectionState";

export interface MobileEnvironmentPresentation extends EnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

export function useMobileEnvironments() {
  const catalog = useAtomValue(mobileEnvironmentConnections.catalogValueAtom);
  const networkStatus = useAtomValue(mobileEnvironmentConnections.networkStatusValueAtom);
  const presentationById = useAtomValue(mobileEnvironmentConnections.presentationsAtom);
  const shellStateById = useAtomValue(mobileEnvironmentConnections.shellStatesAtom);

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
          }) satisfies MobileEnvironmentPresentation,
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

export function useMobileEnvironmentActions() {
  const connectPairingUrl = useAtomSet(connectMobilePairingUrl, {
    mode: "promise",
  });
  const { register, remove, retryNow } = useMobileEnvironmentConnectionActions();
  const refreshRelayEnvironments = useAtomSet(mobileRelayEnvironmentDiscovery.refresh, {
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
    connectPairingUrl,
    connectRelayEnvironment,
    removeEnvironment: remove,
    retryEnvironment: retryNow,
    refreshRelayEnvironments,
  };
}

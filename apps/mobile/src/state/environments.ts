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
import { useCallback, useMemo } from "react";

import { environmentCatalog } from "../connection/catalog";
import { connectPairingUrl as connectPairingUrlAtom } from "../connection/onboarding";
import { environmentPresentations } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { relayEnvironmentDiscovery } from "./relay";

export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

export function projectEnvironmentPresentation(
  environmentId: EnvironmentId,
  presentation: BaseEnvironmentPresentation,
): EnvironmentPresentation {
  return {
    ...presentation,
    environmentId,
    label: presentation.entry.target.label,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    relayManaged: presentation.entry.target._tag === "RelayConnectionTarget",
  };
}

export function useEnvironments() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const networkStatus = useAtomValue(environmentCatalog.networkStatusValueAtom);
  const presentationById = useAtomValue(environmentPresentations.presentationsAtom);

  const environments = useMemo(
    () =>
      [...presentationById.entries()].map(([environmentId, presentation]) =>
        projectEnvironmentPresentation(environmentId, presentation),
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

export function useEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentCatalog.stateAtom(environmentId));
}

export function useEnvironmentConnectionActions() {
  return {
    register: useAtomSet(environmentCatalog.register, { mode: "promise" }),
    remove: useAtomSet(environmentCatalog.remove, { mode: "promise" }),
    removeRelayEnvironments: useAtomSet(environmentCatalog.removeRelayEnvironments, {
      mode: "promise",
    }),
    retryNow: useAtomSet(environmentCatalog.retryNow, { mode: "promise" }),
  };
}

export function useEnvironmentActions() {
  const connectPairingUrl = useAtomSet(connectPairingUrlAtom, {
    mode: "promise",
  });
  const { register, remove, retryNow } = useEnvironmentConnectionActions();
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
    connectPairingUrl,
    connectRelayEnvironment,
    removeEnvironment: remove,
    retryEnvironment: retryNow,
    refreshRelayEnvironments,
  };
}

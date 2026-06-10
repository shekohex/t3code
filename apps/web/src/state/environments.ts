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
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { environmentCatalog } from "../connection/catalog";
import {
  connectPairing as connectPairingAtom,
  connectSshEnvironment as connectSshEnvironmentAtom,
} from "../connection/onboarding";
import { environmentPresentations, useEnvironmentPresentation } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { relayEnvironmentDiscovery } from "./relay";
import { usePreparedConnection } from "./session";

export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

const primaryEnvironmentIdAtom = Atom.make((get) => {
  for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return environmentId;
    }
  }
  return null;
}).pipe(Atom.withLabel("web-primary-environment-id"));

function projectEnvironmentPresentation(
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

export function usePrimaryEnvironmentId(): EnvironmentId | null {
  return useAtomValue(primaryEnvironmentIdAtom);
}

export function useEnvironment(
  environmentId: EnvironmentId | null,
): EnvironmentPresentation | null {
  const { presentation } = useEnvironmentPresentation(environmentId);
  return useMemo(
    () =>
      environmentId === null || presentation === null
        ? null
        : projectEnvironmentPresentation(environmentId, presentation),
    [environmentId, presentation],
  );
}

export function usePrimaryEnvironment(): EnvironmentPresentation | null {
  return useEnvironment(usePrimaryEnvironmentId());
}

export function useEnvironmentHttpBaseUrl(environmentId: EnvironmentId | null): string | null {
  const prepared = usePreparedConnection(environmentId);
  return Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

export function useRelayEnvironmentDiscovery() {
  return useAtomValue(relayEnvironmentDiscovery.stateValueAtom);
}

export function useEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentCatalog.stateAtom(environmentId));
}

export function useEnvironmentConnectionActions() {
  const register = useAtomSet(environmentCatalog.register, { mode: "promise" });
  const remove = useAtomSet(environmentCatalog.remove, { mode: "promise" });
  const removeRelayEnvironments = useAtomSet(environmentCatalog.removeRelayEnvironments, {
    mode: "promise",
  });
  const retryNow = useAtomSet(environmentCatalog.retryNow, { mode: "promise" });

  return useMemo(
    () => ({
      register,
      remove,
      removeRelayEnvironments,
      retryNow,
    }),
    [register, remove, removeRelayEnvironments, retryNow],
  );
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

  return useMemo(
    () => ({
      connectPairing,
      connectSshEnvironment,
      connectRelayEnvironment,
      removeEnvironment: remove,
      retryEnvironment: retryNow,
      refreshRelayEnvironments,
    }),
    [
      connectPairing,
      connectRelayEnvironment,
      connectSshEnvironment,
      refreshRelayEnvironments,
      remove,
      retryNow,
    ],
  );
}

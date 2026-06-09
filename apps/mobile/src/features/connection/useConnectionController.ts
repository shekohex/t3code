import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import { useCallback, useMemo } from "react";

import { useEnvironmentActions, useEnvironments } from "../../state/environments";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { projectWorkspaceEnvironment, type WorkspaceEnvironment } from "../../state/workspaceModel";

export interface RelayEnvironmentView {
  readonly environment: RelayClientEnvironmentRecord;
  readonly availability: "checking" | "online" | "offline" | "error";
  readonly status: RelayEnvironmentStatusResponse | null;
  readonly error: string | null;
  readonly traceId: string | null;
}

export function useConnectionController() {
  const { environments } = useEnvironments();
  const actions = useEnvironmentActions();
  const discovery = useAtomValue(relayEnvironmentDiscovery.stateValueAtom);

  const connectedEnvironments = useMemo<ReadonlyArray<WorkspaceEnvironment>>(
    () => environments.map(projectWorkspaceEnvironment),
    [environments],
  );
  const registeredIds = useMemo(
    () => new Set(connectedEnvironments.map((environment) => environment.environmentId)),
    [connectedEnvironments],
  );
  const relayEnvironments = useMemo<ReadonlyArray<RelayEnvironmentView>>(
    () =>
      [...discovery.environments.values()].map((entry) => ({
        environment: entry.environment,
        availability: entry.availability,
        status: Option.getOrNull(entry.status),
        error: Option.getOrNull(entry.error)?.message ?? null,
        traceId: Option.getOrNull(entry.error)?.traceId ?? null,
      })),
    [discovery.environments],
  );
  const availableRelayEnvironments = useMemo(
    () => relayEnvironments.filter((entry) => !registeredIds.has(entry.environment.environmentId)),
    [registeredIds, relayEnvironments],
  );

  const connectPairingUrl = useCallback(
    (pairingUrl: string) => actions.connectPairingUrl(pairingUrl),
    [actions],
  );
  const connectRelayEnvironment = useCallback(
    (environment: RelayClientEnvironmentRecord) => actions.connectRelayEnvironment(environment),
    [actions],
  );
  const removeEnvironment = useCallback(
    (environmentId: EnvironmentId) => actions.removeEnvironment(environmentId),
    [actions],
  );
  const retryEnvironment = useCallback(
    (environmentId: EnvironmentId) => actions.retryEnvironment(environmentId),
    [actions],
  );

  return {
    connectedEnvironments,
    relayEnvironments,
    availableRelayEnvironments,
    relayDiscovery: {
      isRefreshing: discovery.refreshing,
      isOffline: discovery.offline,
      error: Option.getOrNull(discovery.error)?.message ?? null,
      errorTraceId: Option.getOrNull(discovery.error)?.traceId ?? null,
    },
    connectPairingUrl,
    connectRelayEnvironment,
    removeEnvironment,
    retryEnvironment,
    refreshRelayEnvironments: actions.refreshRelayEnvironments,
  };
}

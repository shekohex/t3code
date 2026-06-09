import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ServerConfig } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";

import { useEnvironmentServerConfig } from "../state/entities";
import { useConnectionController } from "../features/connection/useConnectionController";
import { useEnvironmentPresentation } from "./presentation";
import {
  projectEnvironmentPresentation,
  type EnvironmentPresentation,
} from "../state/environments";
import { useWorkspaceState } from "../state/workspace";
import { projectWorkspaceEnvironment, type WorkspaceEnvironment } from "../state/workspaceModel";
import type { SavedRemoteConnection } from "../lib/connection";
import { appAtomRegistry } from "./atom-registry";
import type { ConnectedEnvironmentSummary, EnvironmentRuntimeState } from "./remote-runtime-types";

const connectionPairingUrlAtom = Atom.make("").pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:connection-pairing-url"),
);

const pendingConnectionErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:pending-connection-error"),
);

export function setPendingConnectionError(message: string | null): void {
  appAtomRegistry.set(pendingConnectionErrorAtom, message);
}

function toSavedConnection(environment: WorkspaceEnvironment): SavedRemoteConnection {
  const displayUrl = environment.displayUrl;
  const wsBaseUrl = displayUrl.startsWith("https://")
    ? displayUrl.replace(/^https:/, "wss:")
    : displayUrl.replace(/^http:/, "ws:");

  return {
    environmentId: environment.environmentId,
    environmentLabel: environment.environmentLabel,
    pairingUrl: displayUrl,
    displayUrl,
    httpBaseUrl: displayUrl,
    wsBaseUrl,
    bearerToken: null,
    ...(environment.isRelayManaged
      ? {
          authenticationMethod: "dpop" as const,
          relayManaged: true as const,
        }
      : { authenticationMethod: "bearer" as const }),
  };
}

function toRuntimeState(
  environment: EnvironmentPresentation,
  serverConfig: ServerConfig | null,
): EnvironmentRuntimeState {
  return {
    connectionState: environment.connection.phase,
    connectionError: environment.connection.error,
    connectionErrorTraceId: environment.connection.traceId,
    serverConfig,
  };
}

export function useSavedRemoteConnections() {
  const workspace = useWorkspaceState();
  const savedConnectionsById = useMemo(
    () =>
      Object.fromEntries(
        workspace.environments.map((environment) => [
          environment.environmentId,
          toSavedConnection(environment),
        ]),
      ) as Record<EnvironmentId, SavedRemoteConnection>,
    [workspace.environments],
  );

  return {
    isLoadingSavedConnection: workspace.state.isLoadingConnections,
    savedConnectionsById,
  };
}

export function useSavedRemoteConnection(
  environmentId: EnvironmentId | null,
): SavedRemoteConnection | null {
  const { presentation } = useEnvironmentPresentation(environmentId);
  if (environmentId === null || presentation === null) {
    return null;
  }
  return toSavedConnection(
    projectWorkspaceEnvironment(projectEnvironmentPresentation(environmentId, presentation)),
  );
}

export function useRemoteEnvironmentRuntime(
  environmentId: EnvironmentId | null,
): EnvironmentRuntimeState | null {
  const { presentation } = useEnvironmentPresentation(environmentId);
  const serverConfig = useEnvironmentServerConfig(environmentId);
  if (environmentId === null || presentation === null) {
    return null;
  }
  return toRuntimeState(projectEnvironmentPresentation(environmentId, presentation), serverConfig);
}

export function useRemoteConnectionStatus() {
  const workspace = useWorkspaceState();
  const pendingConnectionError = useAtomValue(pendingConnectionErrorAtom);
  const connectedEnvironments = useMemo<ReadonlyArray<ConnectedEnvironmentSummary>>(
    () =>
      workspace.environments.map((environment) => ({
        environmentId: environment.environmentId,
        environmentLabel: environment.environmentLabel,
        displayUrl: environment.displayUrl,
        isRelayManaged: environment.isRelayManaged,
        connectionState: environment.connectionState,
        connectionError: environment.connectionError,
        connectionErrorTraceId: environment.connectionErrorTraceId,
      })),
    [workspace.environments],
  );

  return {
    connectedEnvironments,
    connectionState: workspace.state.connectionState,
    connectionError: pendingConnectionError ?? workspace.state.connectionError,
  };
}

export function useRemoteConnections() {
  const controller = useConnectionController();
  const connectionPairingUrl = useAtomValue(connectionPairingUrlAtom);
  const pendingConnectionError = useAtomValue(pendingConnectionErrorAtom);
  const { connectedEnvironments, connectionError, connectionState } = useRemoteConnectionStatus();

  const onChangeConnectionPairingUrl = useCallback((pairingUrl: string) => {
    appAtomRegistry.set(connectionPairingUrlAtom, pairingUrl);
  }, []);

  const onConnectPress = useCallback(
    async (pairingUrl?: string) => {
      try {
        const nextPairingUrl = pairingUrl ?? connectionPairingUrl;
        setPendingConnectionError(null);
        await controller.connectPairingUrl(nextPairingUrl);
        appAtomRegistry.set(connectionPairingUrlAtom, "");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to pair with the environment.";
        setPendingConnectionError(message);
        throw error;
      }
    },
    [connectionPairingUrl, controller],
  );

  const onReconnectEnvironment = useCallback(
    (environmentId: EnvironmentId) => {
      void controller.retryEnvironment(environmentId);
    },
    [controller],
  );

  const onRemoveEnvironmentPress = useCallback(
    (environmentId: EnvironmentId) => {
      const environment = connectedEnvironments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      if (!environment) {
        return;
      }
      Alert.alert(
        "Remove environment?",
        `Disconnect and forget ${environment.environmentLabel} on this device.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              void controller.removeEnvironment(environmentId);
            },
          },
        ],
      );
    },
    [connectedEnvironments, controller],
  );

  return {
    connectionPairingUrl,
    connectionState,
    connectionError,
    pairingConnectionError: pendingConnectionError,
    connectedEnvironments,
    connectedEnvironmentCount: connectedEnvironments.length,
    onChangeConnectionPairingUrl,
    onConnectPress,
    onReconnectEnvironment,
    onUpdateEnvironment: () => undefined,
    onRemoveEnvironmentPress,
  };
}

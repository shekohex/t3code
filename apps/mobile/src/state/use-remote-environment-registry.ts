import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";

import { useMobileConnectionController } from "../connection/useMobileConnectionController";
import { useMobileWorkspace } from "../connection/useMobileWorkspace";
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

function toSavedConnection(
  environment: ReturnType<typeof useMobileWorkspace>["environments"][number],
): SavedRemoteConnection {
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
  environment: ReturnType<typeof useMobileWorkspace>["environments"][number],
  serverConfig: ReturnType<typeof useMobileWorkspace>["serverConfigByEnvironmentId"],
): EnvironmentRuntimeState {
  return {
    connectionState: environment.connectionState,
    connectionError: environment.connectionError,
    connectionErrorTraceId: environment.connectionErrorTraceId,
    serverConfig: serverConfig.get(environment.environmentId) ?? null,
  };
}

function toConnectedEnvironment(
  environment: ReturnType<typeof useMobileWorkspace>["environments"][number],
): ConnectedEnvironmentSummary {
  return {
    environmentId: environment.environmentId,
    environmentLabel: environment.environmentLabel,
    displayUrl: environment.displayUrl,
    isRelayManaged: environment.isRelayManaged,
    connectionState: environment.connectionState,
    connectionError: environment.connectionError,
    connectionErrorTraceId: environment.connectionErrorTraceId,
  };
}

export function useRemoteEnvironmentState() {
  const workspace = useMobileWorkspace();
  const connectionPairingUrl = useAtomValue(connectionPairingUrlAtom);
  const pendingConnectionError = useAtomValue(pendingConnectionErrorAtom);
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
  const environmentStateById = useMemo(
    () =>
      Object.fromEntries(
        workspace.environments.map((environment) => [
          environment.environmentId,
          toRuntimeState(environment, workspace.serverConfigByEnvironmentId),
        ]),
      ) as Record<EnvironmentId, EnvironmentRuntimeState>,
    [workspace.environments, workspace.serverConfigByEnvironmentId],
  );

  return {
    isLoadingSavedConnection: workspace.state.isLoadingConnections,
    connectionPairingUrl,
    pendingConnectionError,
    savedConnectionsById,
    environmentStateById,
  };
}

export function useRemoteConnectionStatus() {
  const workspace = useMobileWorkspace();
  const pendingConnectionError = useAtomValue(pendingConnectionErrorAtom);
  const connectedEnvironments = useMemo(
    () => workspace.environments.map(toConnectedEnvironment),
    [workspace.environments],
  );

  return {
    connectedEnvironments,
    connectionState: workspace.state.connectionState,
    connectionError: pendingConnectionError ?? workspace.state.connectionError,
  };
}

export function useRemoteConnections() {
  const controller = useMobileConnectionController();
  const { connectionPairingUrl, pendingConnectionError } = useRemoteEnvironmentState();
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

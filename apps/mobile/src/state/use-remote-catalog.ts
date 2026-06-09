import type { EnvironmentConnectionPhase, NetworkStatus } from "@t3tools/client-runtime";

import type { MobileWorkspaceState } from "../connection/mobileWorkspaceModel";
import { useMobileWorkspace } from "../connection/useMobileWorkspace";

export interface RemoteCatalogState {
  readonly isLoadingSavedConnections: boolean;
  readonly hasSavedConnections: boolean;
  readonly hasLoadedShellSnapshot: boolean;
  readonly hasPendingShellSnapshot: boolean;
  readonly hasReadyEnvironment: boolean;
  readonly hasConnectingEnvironment: boolean;
  readonly connectingEnvironments: MobileWorkspaceState["connectingEnvironments"];
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly shellSnapshotError: string | null;
  readonly latestCachedSnapshotReceivedAt: string | null;
  readonly networkStatus: NetworkStatus;
}

export function useRemoteCatalog() {
  const workspace = useMobileWorkspace();
  const state: RemoteCatalogState = {
    isLoadingSavedConnections: workspace.state.isLoadingConnections,
    hasSavedConnections: workspace.state.hasConnections,
    hasLoadedShellSnapshot: workspace.state.hasLoadedShellSnapshot,
    hasPendingShellSnapshot: workspace.state.hasPendingShellSnapshot,
    hasReadyEnvironment: workspace.state.hasReadyEnvironment,
    hasConnectingEnvironment: workspace.state.hasConnectingEnvironment,
    connectingEnvironments: workspace.state.connectingEnvironments,
    connectionState: workspace.state.connectionState,
    connectionError: workspace.state.connectionError,
    shellSnapshotError: workspace.state.shellSnapshotError,
    latestCachedSnapshotReceivedAt: workspace.state.latestCachedSnapshotReceivedAt,
    networkStatus: workspace.state.networkStatus,
  };

  return {
    projects: workspace.projects,
    threads: workspace.threads,
    serverConfigByEnvironmentId: Object.fromEntries(workspace.serverConfigByEnvironmentId),
    connectionState: state.connectionState,
    connectionError: state.connectionError,
    state,
    hasRemoteActivity: workspace.hasRemoteActivity,
  };
}

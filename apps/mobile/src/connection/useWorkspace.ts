import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { environmentShellSummaryAtom } from "./connectionRuntime";
import { projectWorkspaceEnvironment, projectWorkspaceState } from "./workspaceModel";
import { useEnvironments } from "./useEnvironments";

export function useWorkspaceState() {
  const { isReady, networkStatus, environments } = useEnvironments();
  const shellSummary = useAtomValue(environmentShellSummaryAtom);
  const projectedEnvironments = useMemo(
    () => environments.map(projectWorkspaceEnvironment),
    [environments],
  );
  const state = useMemo(
    () =>
      projectWorkspaceState({
        isReady,
        networkStatus,
        environments: projectedEnvironments,
        shellSummary,
      }),
    [isReady, networkStatus, projectedEnvironments, shellSummary],
  );

  return {
    environments: projectedEnvironments,
    state,
  };
}

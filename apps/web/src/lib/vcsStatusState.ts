import { type VcsStatusTarget } from "@t3tools/client-runtime/state/vcs";

import { useRepositoryStatus } from "../connection/appQueries";

export type { VcsStatusTarget };

export function resetVcsStatusStateForTests(): void {}

export function useVcsStatus(target: VcsStatusTarget) {
  const state = useRepositoryStatus(target);
  return {
    data: state.data,
    error: state.error,
    isPending: state.isPending,
  };
}

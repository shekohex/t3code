import { type VcsStatusTarget } from "@t3tools/client-runtime/state/vcs";

import { useRepositoryStatus } from "../connection/appQueries";

export function useVcsStatus(target: VcsStatusTarget) {
  const state = useRepositoryStatus(target);
  return {
    data: state.data,
    error: state.error,
    cause: null,
    isPending: state.isPending,
  };
}

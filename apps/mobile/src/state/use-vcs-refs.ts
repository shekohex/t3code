import { type VcsRefTarget } from "@t3tools/client-runtime/state/vcs";

import { useBranches } from "../connection/appQueries";

export function useVcsRefs(target: VcsRefTarget) {
  const state = useBranches(target);
  return {
    data: state.data,
    isPending: state.isPending,
    error: state.error,
    refresh: state.refresh,
  };
}

import { useAtomSet } from "@effect/atom-react";
import { createVcsEnvironmentAtoms } from "@t3tools/client-runtime/state/vcs";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);

export function useVcsListRefs(target: Parameters<typeof vcsEnvironment.listRefs>[0] | null) {
  return useEnvironmentQuery(target === null ? null : vcsEnvironment.listRefs(target));
}

export function useVcsStatus(target: Parameters<typeof vcsEnvironment.status>[0] | null) {
  return useEnvironmentQuery(target === null ? null : vcsEnvironment.status(target));
}

export function useVcsActions() {
  return {
    pull: useAtomSet(vcsEnvironment.pull, { mode: "promise" }),
    refreshStatus: useAtomSet(vcsEnvironment.refreshStatus, { mode: "promise" }),
    createWorktree: useAtomSet(vcsEnvironment.createWorktree, { mode: "promise" }),
    removeWorktree: useAtomSet(vcsEnvironment.removeWorktree, { mode: "promise" }),
    createRef: useAtomSet(vcsEnvironment.createRef, { mode: "promise" }),
    switchRef: useAtomSet(vcsEnvironment.switchRef, { mode: "promise" }),
    init: useAtomSet(vcsEnvironment.init, { mode: "promise" }),
  };
}

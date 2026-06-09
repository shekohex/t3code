import { useAtomSet } from "@effect/atom-react";
import { createVcsEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

export const webVcsEnvironment = createVcsEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebVcsListRefs(target: Parameters<typeof webVcsEnvironment.listRefs>[0] | null) {
  return useWebEnvironmentQuery(target === null ? null : webVcsEnvironment.listRefs(target));
}

export function useWebVcsStatus(target: Parameters<typeof webVcsEnvironment.status>[0] | null) {
  return useWebEnvironmentQuery(target === null ? null : webVcsEnvironment.status(target));
}

export function useWebVcsActions() {
  return {
    pull: useAtomSet(webVcsEnvironment.pull, { mode: "promise" }),
    refreshStatus: useAtomSet(webVcsEnvironment.refreshStatus, { mode: "promise" }),
    createWorktree: useAtomSet(webVcsEnvironment.createWorktree, { mode: "promise" }),
    removeWorktree: useAtomSet(webVcsEnvironment.removeWorktree, { mode: "promise" }),
    createRef: useAtomSet(webVcsEnvironment.createRef, { mode: "promise" }),
    switchRef: useAtomSet(webVcsEnvironment.switchRef, { mode: "promise" }),
    init: useAtomSet(webVcsEnvironment.init, { mode: "promise" }),
  };
}

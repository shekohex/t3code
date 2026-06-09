import { useAtomSet } from "@effect/atom-react";
import { createVcsEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

export const mobileVcsEnvironment = createVcsEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileVcsListRefs(
  target: Parameters<typeof mobileVcsEnvironment.listRefs>[0] | null,
) {
  return useMobileEnvironmentQuery(target === null ? null : mobileVcsEnvironment.listRefs(target));
}

export function useMobileVcsStatus(
  target: Parameters<typeof mobileVcsEnvironment.status>[0] | null,
) {
  return useMobileEnvironmentQuery(target === null ? null : mobileVcsEnvironment.status(target));
}

export function useMobileVcsActions() {
  return {
    pull: useAtomSet(mobileVcsEnvironment.pull, { mode: "promise" }),
    refreshStatus: useAtomSet(mobileVcsEnvironment.refreshStatus, { mode: "promise" }),
    createWorktree: useAtomSet(mobileVcsEnvironment.createWorktree, { mode: "promise" }),
    removeWorktree: useAtomSet(mobileVcsEnvironment.removeWorktree, { mode: "promise" }),
    createRef: useAtomSet(mobileVcsEnvironment.createRef, { mode: "promise" }),
    switchRef: useAtomSet(mobileVcsEnvironment.switchRef, { mode: "promise" }),
    init: useAtomSet(mobileVcsEnvironment.init, { mode: "promise" }),
  };
}

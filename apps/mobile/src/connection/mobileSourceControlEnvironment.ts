import { useAtomSet } from "@effect/atom-react";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileSourceControlEnvironment = createSourceControlEnvironmentAtoms(
  mobileConnectionAtomRuntime,
);

export function useMobileSourceControlDiscovery(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileSourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
}

export function useMobileSourceControlRepository(
  target: Parameters<typeof mobileSourceControlEnvironment.repository>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileSourceControlEnvironment.repository(target),
  );
}

export function useMobileSourceControlActions() {
  return {
    lookupRepository: useAtomSet(mobileSourceControlEnvironment.lookupRepository, {
      mode: "promise",
    }),
    cloneRepository: useAtomSet(mobileSourceControlEnvironment.cloneRepository, {
      mode: "promise",
    }),
    publishRepository: useAtomSet(mobileSourceControlEnvironment.publishRepository, {
      mode: "promise",
    }),
  };
}

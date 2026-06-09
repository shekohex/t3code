import { useAtomSet } from "@effect/atom-react";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webSourceControlEnvironment = createSourceControlEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebSourceControlDiscovery(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webSourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
}

export function useWebSourceControlRepository(
  target: Parameters<typeof webSourceControlEnvironment.repository>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webSourceControlEnvironment.repository(target),
  );
}

export function useWebSourceControlActions() {
  return {
    lookupRepository: useAtomSet(webSourceControlEnvironment.lookupRepository, {
      mode: "promise",
    }),
    cloneRepository: useAtomSet(webSourceControlEnvironment.cloneRepository, {
      mode: "promise",
    }),
    publishRepository: useAtomSet(webSourceControlEnvironment.publishRepository, {
      mode: "promise",
    }),
  };
}

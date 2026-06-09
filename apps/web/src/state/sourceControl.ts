import { useAtomSet } from "@effect/atom-react";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);

export function useSourceControlDiscovery(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
}

export function useSourceControlRepository(
  target: Parameters<typeof sourceControlEnvironment.repository>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : sourceControlEnvironment.repository(target));
}

export function useSourceControlActions() {
  return {
    lookupRepository: useAtomSet(sourceControlEnvironment.lookupRepository, {
      mode: "promise",
    }),
    cloneRepository: useAtomSet(sourceControlEnvironment.cloneRepository, {
      mode: "promise",
    }),
    publishRepository: useAtomSet(sourceControlEnvironment.publishRepository, {
      mode: "promise",
    }),
  };
}

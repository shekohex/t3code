import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webAuthEnvironment = createAuthEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebAuthAccessChanges(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webAuthEnvironment.accessChanges({ environmentId, input: null }),
  );
}

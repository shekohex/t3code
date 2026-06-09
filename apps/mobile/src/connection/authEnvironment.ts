import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime/state/auth";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);

export function useAuthAccessChanges(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : authEnvironment.accessChanges({ environmentId, input: null }),
  );
}

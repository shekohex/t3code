import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileAuthEnvironment = createAuthEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileAuthAccessChanges(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileAuthEnvironment.accessChanges({ environmentId, input: null }),
  );
}

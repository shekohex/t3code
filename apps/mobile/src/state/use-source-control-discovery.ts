import type { EnvironmentId } from "@t3tools/contracts";

import { useSourceControlCapabilities } from "../connection/appQueries";

export function useSourceControlDiscovery(environmentId: EnvironmentId | null) {
  return useSourceControlCapabilities(environmentId);
}

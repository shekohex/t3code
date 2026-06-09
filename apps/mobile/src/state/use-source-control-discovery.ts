import type { EnvironmentId } from "@t3tools/contracts";

import { useSourceControlCapabilities } from "../state/queries";

export function useSourceControlDiscovery(environmentId: EnvironmentId | null) {
  return useSourceControlCapabilities(environmentId);
}

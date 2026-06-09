import type { EnvironmentId } from "@t3tools/contracts";

import { useSourceControlCapabilities } from "../state/queries";
import { usePrimaryEnvironment } from "../state/environments";

interface SourceControlDiscoveryTargetInput {
  readonly environmentId?: EnvironmentId | null;
}

export function resetSourceControlDiscoveryStateForTests(): void {}

export function useSourceControlDiscovery(input?: SourceControlDiscoveryTargetInput) {
  const primaryEnvironment = usePrimaryEnvironment();
  return useSourceControlCapabilities(
    input?.environmentId ?? primaryEnvironment?.environmentId ?? null,
  );
}

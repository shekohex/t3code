import { useAtomSet } from "@effect/atom-react";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

export const mobileOrchestrationEnvironment = createOrchestrationEnvironmentAtoms(
  mobileConnectionAtomRuntime,
);

export function useMobileTurnDiff(
  target: Parameters<typeof mobileOrchestrationEnvironment.turnDiff>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileOrchestrationEnvironment.turnDiff(target),
  );
}

export function useMobileFullThreadDiff(
  target: Parameters<typeof mobileOrchestrationEnvironment.fullThreadDiff>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileOrchestrationEnvironment.fullThreadDiff(target),
  );
}

export function useMobileArchivedShellSnapshot(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileOrchestrationEnvironment.archivedShellSnapshot({
          environmentId,
          input: {},
        }),
  );
}

export function useMobileOrchestrationActions() {
  return {
    replayEvents: useAtomSet(mobileOrchestrationEnvironment.replayEvents, {
      mode: "promise",
    }),
  };
}

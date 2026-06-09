import { useAtomSet } from "@effect/atom-react";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);

export function useTurnDiff(
  target: Parameters<typeof orchestrationEnvironment.turnDiff>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : orchestrationEnvironment.turnDiff(target));
}

export function useFullThreadDiff(
  target: Parameters<typeof orchestrationEnvironment.fullThreadDiff>[0] | null,
) {
  return useEnvironmentQuery(
    target === null ? null : orchestrationEnvironment.fullThreadDiff(target),
  );
}

export function useArchivedShellSnapshot(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : orchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} }),
  );
}

export function useOrchestrationActions() {
  return {
    replayEvents: useAtomSet(orchestrationEnvironment.replayEvents, { mode: "promise" }),
  };
}

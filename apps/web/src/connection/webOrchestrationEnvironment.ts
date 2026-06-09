import { useAtomSet } from "@effect/atom-react";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

export const webOrchestrationEnvironment =
  createOrchestrationEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebTurnDiff(
  target: Parameters<typeof webOrchestrationEnvironment.turnDiff>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webOrchestrationEnvironment.turnDiff(target),
  );
}

export function useWebFullThreadDiff(
  target: Parameters<typeof webOrchestrationEnvironment.fullThreadDiff>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webOrchestrationEnvironment.fullThreadDiff(target),
  );
}

export function useWebArchivedShellSnapshot(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webOrchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} }),
  );
}

export function useWebOrchestrationActions() {
  return {
    replayEvents: useAtomSet(webOrchestrationEnvironment.replayEvents, { mode: "promise" }),
  };
}

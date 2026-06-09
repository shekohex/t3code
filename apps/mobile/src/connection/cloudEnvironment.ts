import { useAtomSet } from "@effect/atom-react";
import { createCloudEnvironmentAtoms } from "@t3tools/client-runtime/state/cloud";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const cloudEnvironment = createCloudEnvironmentAtoms(connectionAtomRuntime);

export function useRelayClientStatus(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : cloudEnvironment.relayClientStatus({ environmentId, input: {} }),
  );
}

export function useCloudActions() {
  return {
    installRelayClient: useAtomSet(cloudEnvironment.installRelayClient, {
      mode: "promise",
    }),
  };
}

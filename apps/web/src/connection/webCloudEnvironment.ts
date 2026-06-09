import { useAtomSet } from "@effect/atom-react";
import { createCloudEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webCloudEnvironment = createCloudEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebRelayClientStatus(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webCloudEnvironment.relayClientStatus({ environmentId, input: {} }),
  );
}

export function useWebCloudActions() {
  return {
    installRelayClient: useAtomSet(webCloudEnvironment.installRelayClient, {
      mode: "promise",
    }),
  };
}

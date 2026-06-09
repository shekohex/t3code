import { useAtomSet } from "@effect/atom-react";
import { createCloudEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileCloudEnvironment = createCloudEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileRelayClientStatus(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileCloudEnvironment.relayClientStatus({ environmentId, input: {} }),
  );
}

export function useMobileCloudActions() {
  return {
    installRelayClient: useAtomSet(mobileCloudEnvironment.installRelayClient, {
      mode: "promise",
    }),
  };
}

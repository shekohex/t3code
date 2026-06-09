import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcStreamMutation,
} from "../atoms.ts";
import type { EnvironmentRegistry } from "../registry.ts";

export function createCloudEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    relayClientStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cloud:relay-client-status",
      tag: WS_METHODS.cloudGetRelayClientStatus,
    }),
    installRelayClient: createEnvironmentRpcStreamMutation(runtime, {
      label: "environment-data:cloud:install-relay-client",
      tag: WS_METHODS.cloudInstallRelayClient,
    }),
  };
}

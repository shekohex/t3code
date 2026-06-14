import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcMutation } from "./runtime.ts";

export function createAssetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    createUrl: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:assets:create-url",
      tag: WS_METHODS.assetsCreateUrl,
    }),
  };
}

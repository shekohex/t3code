import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "../atoms.ts";
import type { EnvironmentRegistry } from "../registry.ts";

export function createFilesystemEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    browse: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:browse",
      tag: WS_METHODS.filesystemBrowse,
    }),
  };
}

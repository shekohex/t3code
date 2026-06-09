import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentSubscriptionAtomFamily } from "../atoms.ts";
import { EMPTY_AUTH_ACCESS_SNAPSHOT, projectAuthAccessSnapshot } from "../authAccessSnapshot.ts";
import type { EnvironmentRegistry } from "../registry.ts";
import { EnvironmentRpc } from "../runtime.ts";

export function createAuthEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    accessChanges: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:auth-access-changes",
      subscribe: (_input: null) =>
        Stream.unwrap(
          EnvironmentRpc.pipe(
            Effect.map((rpc) =>
              rpc
                .subscribe(WS_METHODS.subscribeAuthAccess, {})
                .pipe(Stream.mapAccum(() => EMPTY_AUTH_ACCESS_SNAPSHOT, projectAuthAccessSnapshot)),
            ),
          ),
        ),
    }),
  };
}

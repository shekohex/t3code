import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);

const EMPTY_PREPARED_CONNECTION_ATOM = Atom.make(Option.none()).pipe(
  Atom.withLabel("mobile-prepared-connection:empty"),
);

export function useEnvironmentConfig(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentSession.configAtom(environmentId));
}

export function usePreparedConnection(environmentId: EnvironmentId | null) {
  return useAtomValue(
    environmentId === null
      ? EMPTY_PREPARED_CONNECTION_ATOM
      : environmentSession.preparedConnectionValueAtom(environmentId),
  );
}

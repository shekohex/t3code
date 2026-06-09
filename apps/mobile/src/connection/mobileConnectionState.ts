import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentPresentation,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { mobileEnvironmentConnections } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("mobile-environment-presentation:empty"),
);
const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("mobile-environment-thread:empty"),
);

export function useMobileEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useMobileEnvironmentQuery(mobileEnvironmentConnections.stateAtom(environmentId));
}

export function useMobileEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const catalog = useAtomValue(mobileEnvironmentConnections.catalogValueAtom);
  const presentation = useAtomValue(
    environmentId === null
      ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
      : mobileEnvironmentConnections.presentationAtom(environmentId),
  );
  return {
    isReady: catalog.isReady,
    presentation,
  };
}

export function useMobileEnvironmentConfig(environmentId: EnvironmentId) {
  return useMobileEnvironmentQuery(mobileEnvironmentConnections.configAtom(environmentId));
}

export function useMobilePreparedConnection(environmentId: EnvironmentId) {
  return useAtomValue(mobileEnvironmentConnections.preparedConnectionValueAtom(environmentId));
}

export function useMobileEnvironmentShell(environmentId: EnvironmentId) {
  return useMobileEnvironmentQuery(mobileEnvironmentConnections.shellStateAtom(environmentId));
}

export function useMobileEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? mobileEnvironmentConnections.threadStateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

export function useMobileEnvironmentConnectionActions() {
  return {
    register: useAtomSet(mobileEnvironmentConnections.register, { mode: "promise" }),
    remove: useAtomSet(mobileEnvironmentConnections.remove, { mode: "promise" }),
    removeRelayEnvironments: useAtomSet(mobileEnvironmentConnections.removeRelayEnvironments, {
      mode: "promise",
    }),
    retryNow: useAtomSet(mobileEnvironmentConnections.retryNow, { mode: "promise" }),
  };
}

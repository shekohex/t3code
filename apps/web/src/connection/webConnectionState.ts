import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentPresentation,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { webEnvironmentConnections } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("web-environment-presentation:empty"),
);
const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("web-environment-thread:empty"),
);

export function useWebEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useWebEnvironmentQuery(webEnvironmentConnections.stateAtom(environmentId));
}

export function useWebEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const catalog = useAtomValue(webEnvironmentConnections.catalogValueAtom);
  const presentation = useAtomValue(
    environmentId === null
      ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
      : webEnvironmentConnections.presentationAtom(environmentId),
  );
  return {
    isReady: catalog.isReady,
    presentation,
  };
}

export function useWebEnvironmentConfig(environmentId: EnvironmentId) {
  return useWebEnvironmentQuery(webEnvironmentConnections.configAtom(environmentId));
}

export function useWebPreparedConnection(environmentId: EnvironmentId) {
  return useAtomValue(webEnvironmentConnections.preparedConnectionValueAtom(environmentId));
}

export function useWebEnvironmentShell(environmentId: EnvironmentId) {
  return useWebEnvironmentQuery(webEnvironmentConnections.shellStateAtom(environmentId));
}

export function useWebEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? webEnvironmentConnections.threadStateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

export function useWebEnvironmentConnectionActions() {
  return {
    register: useAtomSet(webEnvironmentConnections.register, { mode: "promise" }),
    remove: useAtomSet(webEnvironmentConnections.remove, { mode: "promise" }),
    removeRelayEnvironments: useAtomSet(webEnvironmentConnections.removeRelayEnvironments, {
      mode: "promise",
    }),
    retryNow: useAtomSet(webEnvironmentConnections.retryNow, { mode: "promise" }),
  };
}

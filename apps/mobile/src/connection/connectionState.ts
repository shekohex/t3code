import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import { type EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  environmentCatalog,
  environmentPresentations,
  environmentSession,
  environmentShell,
  environmentThreads,
} from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("mobile-environment-presentation:empty"),
);
const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("mobile-environment-thread:empty"),
);

export function useEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentCatalog.stateAtom(environmentId));
}

export function useEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const presentation = useAtomValue(
    environmentId === null
      ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
      : environmentPresentations.presentationAtom(environmentId),
  );
  return {
    isReady: catalog.isReady,
    presentation,
  };
}

export function useEnvironmentConfig(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentSession.configAtom(environmentId));
}

export function usePreparedConnection(environmentId: EnvironmentId) {
  return useAtomValue(environmentSession.preparedConnectionValueAtom(environmentId));
}

export function useEnvironmentShell(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentShell.stateAtom(environmentId));
}

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

export function useEnvironmentConnectionActions() {
  return {
    register: useAtomSet(environmentCatalog.register, { mode: "promise" }),
    remove: useAtomSet(environmentCatalog.remove, { mode: "promise" }),
    removeRelayEnvironments: useAtomSet(environmentCatalog.removeRelayEnvironments, {
      mode: "promise",
    }),
    retryNow: useAtomSet(environmentCatalog.retryNow, { mode: "promise" }),
  };
}

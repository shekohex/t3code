import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";

import { useStore } from "../store";
import { useWebEnvironmentThread } from "./webConnectionState";
import { webEnvironmentConnections } from "./webConnectionRuntime";
import { useWebEnvironmentHttpBaseUrl } from "./useWebEnvironments";
import { WebServerStateProjection } from "./WebServerStateProjection";

export function WebConnectionProjections() {
  return (
    <>
      <WebEnvironmentShellProjection />
      <WebServerStateProjection />
    </>
  );
}

export function WebEnvironmentShellProjection() {
  const catalog = useAtomValue(webEnvironmentConnections.catalogValueAtom);
  const shellStates = useAtomValue(webEnvironmentConnections.shellStatesAtom);
  const projectedEnvironmentIds = useRef<ReadonlySet<EnvironmentId>>(new Set());

  useEffect(() => {
    const nextEnvironmentIds = new Set(catalog.entries.keys());
    const store = useStore.getState();

    for (const [environmentId, shellState] of shellStates) {
      if (Option.isSome(shellState.snapshot)) {
        store.syncServerShellSnapshot(shellState.snapshot.value, environmentId);
      }
    }
    for (const environmentId of projectedEnvironmentIds.current) {
      if (!nextEnvironmentIds.has(environmentId)) {
        store.removeEnvironmentState(environmentId);
      }
    }

    projectedEnvironmentIds.current = nextEnvironmentIds;
  }, [catalog.entries, shellStates]);

  return null;
}

export function WebEnvironmentThreadProjection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const state = useWebEnvironmentThread(props.environmentId, props.threadId);
  const httpBaseUrl = useWebEnvironmentHttpBaseUrl(props.environmentId);

  useEffect(() => {
    if (Option.isSome(state.data)) {
      useStore
        .getState()
        .syncServerThreadDetail(state.data.value, props.environmentId, httpBaseUrl);
    }
  }, [httpBaseUrl, props.environmentId, state.data]);

  return null;
}

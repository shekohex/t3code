"use client";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { readPreviewStateRevision, usePreviewStateStore } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { refreshPreviewSessionState, usePreviewSessionState } from "./previewSessionState";

export function usePreviewSession(threadRef: ScopedThreadRef): void {
  const query = usePreviewSessionState(threadRef);
  const events = useEnvironmentQuery(
    previewEnvironment.events({
      environmentId: threadRef.environmentId,
      input: {},
    }),
  );
  const open = useAtomCommand(previewEnvironment.open);
  const applyServerSnapshot = usePreviewStateStore((state) => state.applyServerSnapshot);
  const applyServerEvent = usePreviewStateStore((state) => state.applyServerEvent);

  useEffect(() => {
    if (
      query.isPending ||
      !query.data ||
      query.data.revision !== readPreviewStateRevision(threadRef)
    ) {
      return;
    }
    let cancelled = false;
    if (query.data.result.sessions.length > 0) {
      for (const snapshot of query.data.result.sessions) {
        applyServerSnapshot(threadRef, snapshot);
      }
      return;
    }

    const localSnapshot =
      usePreviewStateStore.getState().byThreadKey[scopedThreadKey(threadRef)]?.snapshot;
    const recoverableUrl =
      localSnapshot && localSnapshot.navStatus._tag !== "Idle" ? localSnapshot.navStatus.url : null;
    if (!recoverableUrl) {
      applyServerSnapshot(threadRef, null);
      return;
    }

    void open({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, url: recoverableUrl },
    }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Failure") {
        return;
      }
      applyServerSnapshot(threadRef, result.value);
      refreshPreviewSessionState(threadRef);
    });

    return () => {
      cancelled = true;
    };
  }, [applyServerSnapshot, open, query.data, query.isPending, threadRef]);

  useEffect(() => {
    const event = events.data;
    if (!event || event.threadId !== threadRef.threadId) return;
    applyServerEvent(threadRef, event);
    if (event.type === "opened" || event.type === "closed") {
      refreshPreviewSessionState(threadRef);
    }
  }, [applyServerEvent, events.data, threadRef]);
}

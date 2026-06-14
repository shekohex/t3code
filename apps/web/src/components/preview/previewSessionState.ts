import type { PreviewListResult, ScopedThreadRef } from "@t3tools/contracts";

import { readPreviewStateRevision } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentQuery } from "~/state/query";

export interface PreviewSessionQueryState {
  readonly data: {
    readonly result: PreviewListResult;
    readonly revision: number;
  } | null;
  readonly error: string | null;
  readonly isPending: boolean;
}

function previewSessionListAtom(threadRef: ScopedThreadRef) {
  return previewEnvironment.list({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
}

export function refreshPreviewSessionState(threadRef: ScopedThreadRef): void {
  appAtomRegistry.refresh(previewSessionListAtom(threadRef));
}

export function usePreviewSessionState(threadRef: ScopedThreadRef): PreviewSessionQueryState {
  const query = useEnvironmentQuery(previewSessionListAtom(threadRef));
  return {
    data:
      query.data === null
        ? null
        : {
            result: query.data,
            revision: readPreviewStateRevision(threadRef),
          },
    error: query.error,
    isPending: query.isPending,
  };
}

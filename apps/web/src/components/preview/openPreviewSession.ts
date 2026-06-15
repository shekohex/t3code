import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import type { PreviewStateStoreState } from "~/previewStateStore";

interface OpenPreviewSessionInput {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<PreviewSessionSnapshot>;
  threadRef: ScopedThreadRef;
  url: string;
  applyServerSnapshot: PreviewStateStoreState["applyServerSnapshot"];
  rememberUrl: PreviewStateStoreState["rememberUrl"];
}

export async function openPreviewSession(
  input: OpenPreviewSessionInput,
): Promise<PreviewSessionSnapshot> {
  const snapshot = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      url: input.url,
    },
  });
  input.applyServerSnapshot(input.threadRef, snapshot);
  input.rememberUrl(
    input.threadRef,
    snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
  );
  return snapshot;
}

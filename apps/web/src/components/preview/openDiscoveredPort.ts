import type { DiscoveredLocalServer, ScopedThreadRef } from "@t3tools/contracts";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { usePreviewStateStore } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openPreviewSession } from "./openPreviewSession";

export async function openDiscoveredPort(input: {
  readonly threadRef: ScopedThreadRef;
  readonly port: DiscoveredLocalServer;
  readonly openPreview: OpenPreviewMutation;
}): Promise<void> {
  const resolvedUrl = resolveDiscoveredServerUrl(input.threadRef.environmentId, input.port.url);
  const previewState = usePreviewStateStore.getState();
  const snapshot = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: resolvedUrl,
    applyServerSnapshot: previewState.applyServerSnapshot,
    rememberUrl: previewState.rememberUrl,
  });
  useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
}

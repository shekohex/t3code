import type {
  AssetCreateUrlResult,
  AssetResource,
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { resolveAssetUrl } from "~/assets/assetUrls";
import { isPreviewSupportedInRuntime, usePreviewStateStore } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

export const isBrowserPreviewFile = (path: string): boolean =>
  /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export type OpenPreviewMutation = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<PreviewSessionSnapshot>;

export async function openUrlInPreview(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly openPreview: OpenPreviewMutation;
}): Promise<void> {
  const snapshot = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: { threadId: input.threadRef.threadId, url: input.url },
  });
  usePreviewStateStore.getState().applyServerSnapshot(input.threadRef, snapshot);
  usePreviewStateStore.getState().rememberUrl(input.threadRef, input.url);
  useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
}

export async function openFileInPreview(input: {
  readonly threadRef: ScopedThreadRef;
  readonly filePath: string;
  readonly httpBaseUrl: string;
  readonly createAssetUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AssetCreateUrlResult>;
  readonly openPreview: OpenPreviewMutation;
}): Promise<void> {
  if (!isPreviewSupportedInRuntime()) {
    throw new Error("The integrated browser is unavailable in this runtime.");
  }
  const asset = await resolveAssetUrl({
    environmentId: input.threadRef.environmentId,
    httpBaseUrl: input.httpBaseUrl,
    resource: {
      _tag: "workspace-file",
      threadId: input.threadRef.threadId,
      path: input.filePath,
    },
    createUrl: input.createAssetUrl,
  });
  await openUrlInPreview({
    threadRef: input.threadRef,
    url: asset.url,
    openPreview: input.openPreview,
  });
}

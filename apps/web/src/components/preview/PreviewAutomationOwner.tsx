"use client";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationRequest,
  PreviewAutomationResponse,
  PreviewAutomationStatus,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useId, useRef } from "react";

import { selectThreadPreviewState, usePreviewStateStore } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { resolveBrowserNavigationTarget } from "~/browser/browserTargetResolver";
import {
  startBrowserRecording,
  stopBrowserRecording,
  useBrowserRecordingStore,
} from "~/browser/browserRecording";
import { previewEnvironment, usePreviewActions } from "~/state/preview";
import { useEnvironmentQuery } from "~/state/query";

import { previewBridge } from "./previewBridge";

const waitForDesktopOverlay = async (
  threadRef: ScopedThreadRef,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = selectThreadPreviewState(usePreviewStateStore.getState().byThreadKey, threadRef);
    const tabId = state.snapshot?.tabId;
    if (tabId && state.desktopOverlay && previewBridge) {
      const status = await previewBridge.automation.status(tabId);
      if (status.available) return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  const error = new Error(`Preview webview did not register within ${timeoutMs}ms.`);
  error.name = "PreviewAutomationTimeoutError";
  throw error;
};

const waitForNavigationReadiness = async (
  tabId: string,
  readiness: PreviewAutomationNavigateInput["readiness"],
  timeoutMs: number,
): Promise<void> => {
  if (!previewBridge || readiness === "none") return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (readiness === "domContentLoaded") {
      const readyState = await previewBridge.automation.evaluate(tabId, {
        expression: "document.readyState",
      });
      if (readyState === "interactive" || readyState === "complete") return;
    } else {
      const status = await previewBridge.automation.status(tabId);
      if (!status.loading) return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  const error = new Error(`Preview navigation did not become ready within ${timeoutMs}ms.`);
  error.name = "PreviewAutomationTimeoutError";
  throw error;
};

const currentStatus = async (
  threadRef: ScopedThreadRef,
  visible: boolean,
): Promise<PreviewAutomationStatus> => {
  const state = selectThreadPreviewState(usePreviewStateStore.getState().byThreadKey, threadRef);
  const tabId = state.snapshot?.tabId ?? null;
  if (tabId && previewBridge && state.desktopOverlay) {
    const status = await previewBridge.automation.status(tabId);
    return { ...status, visible };
  }
  const navStatus = state.snapshot?.navStatus;
  return {
    available: Boolean(previewBridge?.automation),
    visible,
    tabId,
    url: navStatus && navStatus._tag !== "Idle" ? navStatus.url : null,
    title: navStatus && navStatus._tag !== "Idle" ? navStatus.title : null,
    loading: navStatus?._tag === "Loading",
  };
};

const serializeError = (error: unknown): NonNullable<PreviewAutomationResponse["error"]> => {
  if (error instanceof Error) {
    const detail =
      "detail" in error && (error as { detail?: unknown }).detail !== undefined
        ? (error as { detail?: unknown }).detail
        : undefined;
    return {
      _tag: error.name.startsWith("PreviewAutomation")
        ? error.name
        : "PreviewAutomationExecutionError",
      message: error.message,
      ...(detail === undefined ? {} : { detail }),
    };
  }
  return {
    _tag: "PreviewAutomationExecutionError",
    message: String(error),
  };
};

export function PreviewAutomationOwner(props: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const { threadRef, visible } = props;
  const automationClientId = useId();
  const automationRequests = useEnvironmentQuery(
    previewEnvironment.automationRequests({
      environmentId: threadRef.environmentId,
      input: { clientId: automationClientId },
    }),
  );
  const { open, respondToAutomation, reportAutomationOwner, clearAutomationOwner } =
    usePreviewActions();
  const ownerStateRef = useRef({ threadRef, visible });
  const handlerRef = useRef<(request: PreviewAutomationRequest) => Promise<unknown>>(
    async () => undefined,
  );
  useEffect(() => {
    ownerStateRef.current = { threadRef, visible };
  }, [threadRef, visible]);

  const handleRequest = useCallback(
    async (request: PreviewAutomationRequest): Promise<unknown> => {
      if (request.threadId !== threadRef.threadId) {
        const error = new Error("Preview automation request targeted a stale thread owner.");
        error.name = "PreviewAutomationUnavailableError";
        throw error;
      }
      const state = selectThreadPreviewState(
        usePreviewStateStore.getState().byThreadKey,
        threadRef,
      );
      const tabId = request.tabId ?? state.snapshot?.tabId ?? null;
      switch (request.operation) {
        case "status":
          return currentStatus(threadRef, visible);
        case "open": {
          const input = request.input as PreviewAutomationOpenInput;
          let activeTabId =
            (input.reuseExistingTab ?? true) ? (state.snapshot?.tabId ?? null) : null;
          if (!activeTabId) {
            const snapshot = await open({
              environmentId: threadRef.environmentId,
              input: {
                threadId: threadRef.threadId,
                ...(input.url ? { url: input.url } : {}),
              },
            });
            usePreviewStateStore.getState().applyServerSnapshot(threadRef, snapshot);
            activeTabId = snapshot.tabId;
          } else if (input.url && previewBridge) {
            await previewBridge.navigate(activeTabId, input.url);
          }
          if (input.show ?? true) {
            useRightPanelStore.getState().openBrowser(threadRef, activeTabId);
          }
          await waitForDesktopOverlay(threadRef, request.timeoutMs);
          return currentStatus(threadRef, input.show ?? true);
        }
        case "navigate": {
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          const input = request.input as PreviewAutomationNavigateInput;
          const resolution = resolveBrowserNavigationTarget(
            threadRef.environmentId,
            input.target ?? { kind: "url", url: input.url! },
          );
          await previewBridge.navigate(tabId, resolution.resolvedUrl);
          await waitForNavigationReadiness(
            tabId,
            input.readiness ?? "load",
            input.timeoutMs ?? request.timeoutMs,
          );
          return currentStatus(threadRef, visible);
        }
        case "snapshot":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.snapshot(tabId);
        case "click":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.click(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.click>[1],
          );
        case "type":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.type(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.type>[1],
          );
        case "press":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.press(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.press>[1],
          );
        case "scroll":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.scroll(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.scroll>[1],
          );
        case "evaluate":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.evaluate(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.evaluate>[1],
          );
        case "waitFor":
          if (!previewBridge || !tabId) throw new Error("Preview tab is not initialized.");
          return previewBridge.automation.waitFor(
            tabId,
            request.input as Parameters<typeof previewBridge.automation.waitFor>[1],
          );
        case "recordingStart": {
          if (!tabId) throw new Error("Preview tab is not initialized.");
          await startBrowserRecording(tabId);
          return {
            tabId,
            recording: true,
            startedAt: useBrowserRecordingStore.getState().startedAt,
          };
        }
        case "recordingStop": {
          if (!tabId) throw new Error("Preview tab is not initialized.");
          const artifact = await stopBrowserRecording(tabId);
          if (!artifact) throw new Error("No active recording exists for this preview tab.");
          return artifact;
        }
      }
    },
    [open, threadRef, visible],
  );
  useEffect(() => {
    handlerRef.current = handleRequest;
  }, [handleRequest]);

  useEffect(() => {
    const request = automationRequests.data;
    if (!request) return;
    void handlerRef.current(request).then(
      (result) =>
        respondToAutomation({
          environmentId: threadRef.environmentId,
          input: {
            requestId: request.requestId,
            ok: true,
            ...(result === undefined ? {} : { result }),
          },
        }),
      (error) =>
        respondToAutomation({
          environmentId: threadRef.environmentId,
          input: {
            requestId: request.requestId,
            ok: false,
            error: serializeError(error),
          },
        }),
    );
  }, [automationRequests.data, respondToAutomation, threadRef.environmentId]);

  useEffect(() => {
    const report = () => {
      const state = selectThreadPreviewState(
        usePreviewStateStore.getState().byThreadKey,
        threadRef,
      );
      void reportAutomationOwner({
        environmentId: threadRef.environmentId,
        input: {
          clientId: automationClientId,
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          tabId: state.snapshot?.tabId ?? null,
          visible,
          supportsAutomation: Boolean(previewBridge?.automation),
          focusedAt: new Date().toISOString(),
        },
      });
    };
    report();
    window.addEventListener("focus", report);
    const unsubscribe = usePreviewStateStore.subscribe((state, previous) => {
      const key = scopedThreadKey(threadRef);
      if (state.byThreadKey[key]?.snapshot?.tabId !== previous.byThreadKey[key]?.snapshot?.tabId) {
        report();
      }
    });
    return () => {
      window.removeEventListener("focus", report);
      unsubscribe();
      void clearAutomationOwner({
        environmentId: threadRef.environmentId,
        input: { clientId: automationClientId },
      });
    };
  }, [automationClientId, clearAutomationOwner, reportAutomationOwner, threadRef, visible]);

  return null;
}

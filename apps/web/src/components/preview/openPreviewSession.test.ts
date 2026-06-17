import type { PreviewOpenInput, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { openPreviewSession } from "./openPreviewSession";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: {
    _tag: "Loading",
    url: "https://t3.chat/",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-11T23:00:00.000Z",
};

describe("openPreviewSession", () => {
  it("applies the RPC response without waiting for a preview event", async () => {
    const open = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(snapshot));
    const applyServerSnapshot = vi.fn();
    const rememberUrl = vi.fn();

    await openPreviewSession({
      openPreview: ({ input }) => open(input),
      threadRef,
      url: "t3.chat",
      applyServerSnapshot,
      rememberUrl,
    });

    expect(open).toHaveBeenCalledWith({ threadId: "thread-1", url: "t3.chat" });
    expect(applyServerSnapshot).toHaveBeenCalledWith(threadRef, snapshot);
    expect(rememberUrl).toHaveBeenCalledWith(threadRef, "https://t3.chat/");
  });

  it("returns failures without mutating preview state", async () => {
    const failure = new Error("preview unavailable");
    const applyServerSnapshot = vi.fn();
    const rememberUrl = vi.fn();

    const result = await openPreviewSession({
      openPreview: async () => AsyncResult.failure(Cause.fail(failure)),
      threadRef,
      url: "t3.chat",
      applyServerSnapshot,
      rememberUrl,
    });

    expect(result._tag).toBe("Failure");
    expect(applyServerSnapshot).not.toHaveBeenCalled();
    expect(rememberUrl).not.toHaveBeenCalled();
  });
});

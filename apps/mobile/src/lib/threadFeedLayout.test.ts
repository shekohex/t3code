import { describe, expect, it } from "vite-plus/test";

import {
  isThreadFeedNearEnd,
  threadFeedDistanceFromEnd,
  threadFeedFooterHeight,
  threadFeedMessageContentHeight,
} from "./threadFeedLayout";

describe("thread feed layout", () => {
  it("accounts for the bottom inset when measuring distance from the end", () => {
    const metrics = {
      contentHeight: 900,
      viewportHeight: 600,
      offsetY: 380,
      bottomInset: 100,
    };

    expect(threadFeedDistanceFromEnd(metrics)).toBe(20);
    expect(isThreadFeedNearEnd(metrics, 50)).toBe(true);
    expect(isThreadFeedNearEnd(metrics, 10)).toBe(false);
  });

  it("fills unused viewport space without changing message content height", () => {
    const footerHeight = threadFeedFooterHeight({
      viewportHeight: 800,
      messageContentHeight: 300,
      topInset: 100,
      bottomInset: 180,
    });

    expect(footerHeight).toBe(400);
    expect(threadFeedMessageContentHeight(700, footerHeight)).toBe(300);
  });

  it("keeps the bottom overlay clearance once messages fill the available viewport", () => {
    expect(
      threadFeedFooterHeight({
        viewportHeight: 800,
        messageContentHeight: 600,
        topInset: 100,
        bottomInset: 180,
      }),
    ).toBe(180);
  });
});

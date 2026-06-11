export interface ThreadFeedScrollMetrics {
  readonly contentHeight: number;
  readonly viewportHeight: number;
  readonly offsetY: number;
  readonly bottomInset: number;
}

export interface ThreadFeedFooterLayout {
  readonly viewportHeight: number;
  readonly messageContentHeight: number;
  readonly topInset: number;
  readonly bottomInset: number;
}

export function threadFeedDistanceFromEnd(metrics: ThreadFeedScrollMetrics): number {
  return metrics.contentHeight + metrics.bottomInset - metrics.viewportHeight - metrics.offsetY;
}

export function isThreadFeedNearEnd(metrics: ThreadFeedScrollMetrics, threshold: number): boolean {
  return threadFeedDistanceFromEnd(metrics) <= threshold;
}

export function threadFeedMessageContentHeight(
  totalContentHeight: number,
  footerHeight: number,
): number {
  return Math.max(0, totalContentHeight - footerHeight);
}

export function threadFeedFooterHeight(layout: ThreadFeedFooterLayout): number {
  "worklet";
  return (
    layout.bottomInset +
    Math.max(
      0,
      layout.viewportHeight - layout.topInset - layout.bottomInset - layout.messageContentHeight,
    )
  );
}

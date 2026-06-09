import type { EnvironmentId, OrchestrationThread, ThreadId } from "@t3tools/contracts";

export interface ThreadDetailState {
  readonly data: OrchestrationThread | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isDeleted: boolean;
}

export interface ThreadDetailTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}

export const EMPTY_THREAD_DETAIL_STATE = Object.freeze<ThreadDetailState>({
  data: null,
  error: null,
  isPending: false,
  isDeleted: false,
});

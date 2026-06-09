import {
  EMPTY_THREAD_DETAIL_STATE,
  type ThreadDetailState,
  type ThreadDetailTarget,
} from "@t3tools/client-runtime";
import * as Option from "effect/Option";

import { useMobileEnvironmentThread } from "../connection/useMobileEnvironmentData";
import { useThreadSelection } from "./use-thread-selection";

export function useThreadDetail(target: ThreadDetailTarget): ThreadDetailState {
  const state = useMobileEnvironmentThread(target.environmentId, target.threadId);
  if (target.environmentId === null || target.threadId === null) {
    return EMPTY_THREAD_DETAIL_STATE;
  }

  return {
    data: Option.getOrNull(state.data),
    error: Option.getOrNull(state.error),
    isPending: state.status === "synchronizing",
    isDeleted: state.status === "deleted",
  };
}

export function useSelectedThreadDetailState() {
  const { selectedThread } = useThreadSelection();
  return useThreadDetail({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
}

export function useSelectedThreadDetail() {
  return useSelectedThreadDetailState().data;
}

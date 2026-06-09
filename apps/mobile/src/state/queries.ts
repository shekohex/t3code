import type {
  EnvironmentId,
  FilesystemBrowseInput,
  OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useMemo, useState } from "react";

import { useFilesystemBrowse } from "./filesystem";
import { useFullThreadDiff, useTurnDiff } from "./orchestration";
import { useProjectSearchEntries } from "./projects";
import { useReviewDiffPreview } from "./review";
import { useSourceControlDiscovery } from "./sourceControl";
import { useEnvironmentThread } from "./threads";
import { useVcsListRefs, useVcsStatus } from "./vcs";
import {
  buildCheckpointDiffTargets,
  normalizeComposerPathSearchQuery,
  type CheckpointDiffTarget,
} from "./queryTargets";

const COMPOSER_PATH_SEARCH_DEBOUNCE_MS = 200;
const COMPOSER_PATH_SEARCH_LIMIT = 20;
const VCS_REF_LIST_LIMIT = 100;

export interface ThreadDetailView {
  readonly data: OrchestrationThread | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isDeleted: boolean;
}

export interface ComposerPathSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string | null;
}

function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
}

export function useThreadDetail(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ThreadDetailView {
  const state = useEnvironmentThread(environmentId, threadId);
  return {
    data: Option.getOrNull(state.data),
    error: Option.getOrNull(state.error),
    isPending: state.status === "synchronizing",
    isDeleted: state.status === "deleted",
  };
}

export function useFilesystemDirectory(
  environmentId: EnvironmentId | null,
  input: FilesystemBrowseInput | null,
) {
  return useFilesystemBrowse(
    environmentId !== null && input !== null ? { environmentId, input } : null,
  );
}

export function useSourceControlCapabilities(environmentId: EnvironmentId | null) {
  return useSourceControlDiscovery(environmentId);
}

export function useBranches(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query?: string | null;
}) {
  const query = input.query?.trim() ?? "";
  return useVcsListRefs(
    input.environmentId !== null && input.cwd !== null
      ? {
          environmentId: input.environmentId,
          input: {
            cwd: input.cwd,
            ...(query.length > 0 ? { query } : {}),
            limit: VCS_REF_LIST_LIMIT,
          },
        }
      : null,
  );
}

export function useRepositoryStatus(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return useVcsStatus(
    input.environmentId !== null && input.cwd !== null
      ? {
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        }
      : null,
  );
}

export function useReviewPreview(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}) {
  return useReviewDiffPreview(
    input.environmentId !== null && input.cwd !== null
      ? {
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        }
      : null,
  );
}

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  const normalizedTarget = useMemo(
    () => ({
      environmentId: target.environmentId,
      cwd: target.cwd,
      query: normalizeComposerPathSearchQuery(target.query),
    }),
    [target.cwd, target.environmentId, target.query],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, COMPOSER_PATH_SEARCH_DEBOUNCE_MS);
  const result = useProjectSearchEntries(
    debouncedTarget.environmentId !== null &&
      debouncedTarget.cwd !== null &&
      debouncedTarget.query.length > 0
      ? {
          environmentId: debouncedTarget.environmentId,
          input: {
            cwd: debouncedTarget.cwd,
            query: debouncedTarget.query,
            limit: COMPOSER_PATH_SEARCH_LIMIT,
          },
        }
      : null,
  );

  return {
    entries: result.data?.entries ?? [],
    error: result.error,
    isPending: normalizedTarget.query !== debouncedTarget.query || result.isPending,
    refresh: result.refresh,
  };
}

export function useCheckpointDiff(target: CheckpointDiffTarget) {
  const targets = useMemo(
    () => buildCheckpointDiffTargets(target),
    [
      target.environmentId,
      target.fromTurnCount,
      target.ignoreWhitespace,
      target.threadId,
      target.toTurnCount,
    ],
  );
  const fullThread = useFullThreadDiff(targets.fullThread);
  const turn = useTurnDiff(targets.turn);
  return targets.fullThread === null ? turn : fullThread;
}

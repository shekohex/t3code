import type {
  EnvironmentId,
  GitActionProgressEvent,
  GitResolvePullRequestResult,
  GitRunStackedActionResult,
  GitStackedAction,
  SourceControlCloneProtocol,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
  ThreadId,
  VcsPullResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import {
  useWebPullRequestResolution,
  useWebRunStackedGitActionState,
  useWebVcsStatus,
} from "./useWebEnvironmentData";
import { useWebGitActions } from "./webGitEnvironment";
import { useWebSourceControlActions as useWebSourceControlMutations } from "./webSourceControlEnvironment";
import { useWebVcsActions } from "./webVcsEnvironment";

export type WebSourceControlActionKind =
  | "init"
  | "pull"
  | "publishRepository"
  | "runStackedAction"
  | "preparePullRequestThread";

export interface WebSourceControlActionScope {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}

interface WebSourceControlActionState<TArgs extends ReadonlyArray<unknown>, TResult> {
  readonly isPending: boolean;
  readonly error: unknown;
  readonly run: (...args: TArgs) => Promise<TResult>;
  readonly resetError: () => void;
}

const actionListeners = new Set<() => void>();
const activeActionCounts = new Map<string, number>();
const pullRequestResolutionCache = new Map<string, GitResolvePullRequestResult>();

function actionKey(kind: WebSourceControlActionKind, scope: WebSourceControlActionScope): string {
  return `${kind}:${scope.environmentId ?? ""}:${scope.cwd ?? ""}`;
}

function notifyActionListeners(): void {
  for (const listener of actionListeners) {
    listener();
  }
}

function beginAction(key: string): () => void {
  activeActionCounts.set(key, (activeActionCounts.get(key) ?? 0) + 1);
  notifyActionListeners();
  let completed = false;
  return () => {
    if (completed) {
      return;
    }
    completed = true;
    const next = (activeActionCounts.get(key) ?? 1) - 1;
    if (next <= 0) {
      activeActionCounts.delete(key);
    } else {
      activeActionCounts.set(key, next);
    }
    notifyActionListeners();
  };
}

function useAction<TArgs extends ReadonlyArray<unknown>, TResult>(input: {
  readonly kind: WebSourceControlActionKind;
  readonly scope: WebSourceControlActionScope;
  readonly action: (...args: TArgs) => Promise<TResult>;
  readonly onSuccess?: () => void;
}): WebSourceControlActionState<TArgs, TResult> {
  const [error, setError] = useState<unknown>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [isTransitionPending, startTransition] = useTransition();
  const key = actionKey(input.kind, input.scope);

  const resetError = useCallback(() => {
    startTransition(() => setError(null));
  }, []);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      const complete = beginAction(key);
      startTransition(() => {
        setError(null);
        setActiveCount((count) => count + 1);
      });
      try {
        const result = await input.action(...args);
        input.onSuccess?.();
        return result;
      } catch (cause) {
        startTransition(() => setError(cause));
        throw cause;
      } finally {
        complete();
        startTransition(() => setActiveCount((count) => Math.max(0, count - 1)));
      }
    },
    [input.action, input.onSuccess, key],
  );

  return {
    error,
    isPending: activeCount > 0 || isTransitionPending,
    resetError,
    run,
  };
}

function requireScope(scope: WebSourceControlActionScope, unavailableMessage: string) {
  if (scope.environmentId === null || scope.cwd === null) {
    throw new Error(unavailableMessage);
  }
  return {
    environmentId: scope.environmentId,
    cwd: scope.cwd,
  };
}

export function useWebSourceControlActionRunning(
  scope: WebSourceControlActionScope,
  kinds: ReadonlyArray<WebSourceControlActionKind>,
): boolean {
  const stableKinds = useMemo(() => kinds.toSorted(), [kinds]);
  return useSyncExternalStore(
    (listener) => {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },
    () => stableKinds.some((kind) => (activeActionCounts.get(actionKey(kind, scope)) ?? 0) > 0),
    () => false,
  );
}

export function useWebVcsInitAction(scope: WebSourceControlActionScope) {
  const vcsActions = useWebVcsActions();
  const action = useCallback(async () => {
    const target = requireScope(scope, "Git init is unavailable.");
    return vcsActions.init({
      environmentId: target.environmentId,
      input: { cwd: target.cwd },
    });
  }, [scope, vcsActions]);
  return useAction({ kind: "init", scope, action });
}

export function useWebVcsPullAction(scope: WebSourceControlActionScope) {
  const vcsActions = useWebVcsActions();
  const status = useWebVcsStatus(
    scope.environmentId !== null && scope.cwd !== null
      ? {
          environmentId: scope.environmentId,
          input: { cwd: scope.cwd },
        }
      : null,
  );
  const action = useCallback(async (): Promise<VcsPullResult> => {
    const target = requireScope(scope, "Git pull is unavailable.");
    return vcsActions.pull({
      environmentId: target.environmentId,
      input: { cwd: target.cwd },
    });
  }, [scope, vcsActions]);
  return useAction({
    kind: "pull",
    scope,
    action,
    onSuccess: status.refresh,
  });
}

export function useWebGitStackedAction(scope: WebSourceControlActionScope) {
  const gitActions = useWebGitActions();
  const progress = useWebRunStackedGitActionState();
  const status = useWebVcsStatus(
    scope.environmentId !== null && scope.cwd !== null
      ? {
          environmentId: scope.environmentId,
          input: { cwd: scope.cwd },
        }
      : null,
  );
  const progressListenerRef = useRef<((event: GitActionProgressEvent) => void) | null>(null);

  useEffect(() => {
    const event = Option.getOrNull(AsyncResult.value(progress));
    if (event !== null && event.cwd === scope.cwd) {
      progressListenerRef.current?.(event);
    }
  }, [progress, progressListenerRef, scope.cwd]);

  const action = useCallback(
    async (input: {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
      onProgress?: (event: GitActionProgressEvent) => void;
    }): Promise<GitRunStackedActionResult> => {
      const target = requireScope(scope, "Git action is unavailable.");
      progressListenerRef.current = input.onProgress ?? null;
      try {
        const event = await gitActions.runStackedAction({
          environmentId: target.environmentId,
          input: {
            actionId: input.actionId,
            cwd: target.cwd,
            action: input.action,
            ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
            ...(input.featureBranch ? { featureBranch: true } : {}),
            ...(input.filePaths?.length ? { filePaths: input.filePaths } : {}),
          },
        });
        if (event.kind === "action_failed") {
          throw new Error(event.message);
        }
        if (event.kind !== "action_finished") {
          throw new Error("Source control action ended without a result.");
        }
        return event.result;
      } finally {
        progressListenerRef.current = null;
      }
    },
    [gitActions, progressListenerRef, scope],
  );

  return useAction({
    kind: "runStackedAction",
    scope,
    action,
    onSuccess: status.refresh,
  });
}

export function useWebSourceControlPublishRepositoryAction(scope: WebSourceControlActionScope) {
  const sourceControlActions = useWebSourceControlMutations();
  const status = useWebVcsStatus(
    scope.environmentId !== null && scope.cwd !== null
      ? {
          environmentId: scope.environmentId,
          input: { cwd: scope.cwd },
        }
      : null,
  );
  const action = useCallback(
    async (input: {
      provider: "github" | "gitlab" | "bitbucket" | "azure-devops";
      repository: string;
      visibility: SourceControlRepositoryVisibility;
      remoteName: string;
      protocol: SourceControlCloneProtocol;
    }): Promise<SourceControlPublishRepositoryResult> => {
      const target = requireScope(scope, "Repository publishing is unavailable.");
      return sourceControlActions.publishRepository({
        environmentId: target.environmentId,
        input: {
          cwd: target.cwd,
          ...input,
        },
      });
    },
    [scope, sourceControlActions],
  );
  return useAction({
    kind: "publishRepository",
    scope,
    action,
    onSuccess: status.refresh,
  });
}

export function useWebPreparePullRequestThreadAction(scope: WebSourceControlActionScope) {
  const gitActions = useWebGitActions();
  const action = useCallback(
    async (input: { reference: string; mode: "local" | "worktree"; threadId?: ThreadId }) => {
      const target = requireScope(scope, "Pull request thread preparation is unavailable.");
      return gitActions.preparePullRequestThread({
        environmentId: target.environmentId,
        input: {
          cwd: target.cwd,
          reference: input.reference,
          mode: input.mode,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      });
    },
    [gitActions, scope],
  );
  return useAction({ kind: "preparePullRequestThread", scope, action });
}

export interface WebPullRequestResolutionTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
}

function pullRequestResolutionKey(target: WebPullRequestResolutionTarget): string | null {
  if (target.environmentId === null || target.cwd === null || target.reference === null) {
    return null;
  }
  return `${target.environmentId}:${target.cwd}:${target.reference}`;
}

export function readCachedWebPullRequestResolution(
  target: WebPullRequestResolutionTarget,
): GitResolvePullRequestResult | null {
  const key = pullRequestResolutionKey(target);
  return key === null ? null : (pullRequestResolutionCache.get(key) ?? null);
}

export function useWebPullRequestResolutionState(target: WebPullRequestResolutionTarget) {
  const query = useWebPullRequestResolution(
    target.environmentId !== null && target.cwd !== null && target.reference !== null
      ? {
          environmentId: target.environmentId,
          input: {
            cwd: target.cwd,
            reference: target.reference,
          },
        }
      : null,
  );
  const key = pullRequestResolutionKey(target);

  useEffect(() => {
    if (key !== null && query.data !== null) {
      pullRequestResolutionCache.set(key, query.data);
    }
  }, [key, query.data]);

  return {
    data: query.data ?? readCachedWebPullRequestResolution(target),
    error: query.error,
    isPending: query.isPending && readCachedWebPullRequestResolution(target) === null,
    isFetching: query.isPending,
    refresh: query.refresh,
  };
}

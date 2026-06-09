import { useCallback, useEffect, useMemo } from "react";

import {
  EnvironmentScopedProjectShell,
  EnvironmentScopedThreadShell,
  type GitActionRequestInput,
  type VcsActionOperation,
  type VcsRef,
} from "@t3tools/client-runtime";
import type { GitRunStackedActionResult } from "@t3tools/contracts";
import {
  dedupeRemoteBranchesWithLocalMatches,
  sanitizeFeatureBranchName,
} from "@t3tools/shared/git";

import { useMobileGitActions } from "../connection/mobileGitEnvironment";
import { useMobileThreadActions } from "../connection/mobileThreadEnvironment";
import { useMobileVcsActions } from "../connection/mobileVcsEnvironment";
import { uuidv4 } from "../lib/uuid";
import { setPendingConnectionError } from "./use-remote-environment-registry";
import {
  beginVcsAction,
  completeVcsAction,
  failVcsAction,
  showGitActionResult,
} from "./use-vcs-action-state";
import { useVcsRefs } from "./use-vcs-refs";
import { useThreadSelection } from "./use-thread-selection";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";

export function useSelectedThreadGitActions() {
  const gitActions = useMobileGitActions();
  const threadActions = useMobileThreadActions();
  const vcsActions = useMobileVcsActions();
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const { selectedThreadCwd, selectedThreadWorktreePath } = useSelectedThreadWorktree();

  const selectedThreadGitRootCwd = selectedThreadProject?.workspaceRoot ?? null;
  const branchTarget = useMemo(
    () => ({
      environmentId: selectedThread?.environmentId ?? null,
      cwd: selectedThreadGitRootCwd,
      query: null,
    }),
    [selectedThread?.environmentId, selectedThreadGitRootCwd],
  );
  const branchState = useVcsRefs(branchTarget);
  const updateThreadGitContext = useCallback(
    async (
      thread: NonNullable<typeof selectedThread>,
      nextState: {
        readonly branch?: string | null;
        readonly worktreePath?: string | null;
      },
    ) => {
      await threadActions.updateMetadata({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          ...(nextState.branch !== undefined ? { branch: nextState.branch } : {}),
          ...(nextState.worktreePath !== undefined ? { worktreePath: nextState.worktreePath } : {}),
        },
      });
    },
    [threadActions],
  );

  const refreshSelectedThreadGitStatus = useCallback(
    async (options?: { readonly quiet?: boolean; readonly cwd?: string | null }) => {
      if (!selectedThread || !selectedThreadProject) {
        return null;
      }

      const cwd = options?.cwd ?? selectedThreadCwd;
      if (!cwd) {
        return null;
      }

      const target = { environmentId: selectedThread.environmentId, cwd };
      if (!options?.quiet) {
        beginVcsAction(target, {
          operation: "refresh_status",
          label: "Refreshing source control status",
        });
      }
      try {
        const result = await vcsActions.refreshStatus({
          environmentId: selectedThread.environmentId,
          input: { cwd },
        });
        if (!options?.quiet) {
          completeVcsAction(target);
        }
        setPendingConnectionError(null);
        return result;
      } catch (error) {
        if (!options?.quiet) {
          failVcsAction(target, "refresh_status", error);
        }
        const message = error instanceof Error ? error.message : "Failed to refresh git status.";
        setPendingConnectionError(message);
        return null;
      }
    },
    [selectedThread, selectedThreadCwd, selectedThreadProject, vcsActions],
  );

  useEffect(() => {
    if (!selectedThread || !selectedThreadProject) {
      return;
    }
    void refreshSelectedThreadGitStatus({ quiet: true });
  }, [refreshSelectedThreadGitStatus, selectedThread, selectedThreadProject]);

  const runSelectedThreadGitMutation = useCallback(
    async <T>(
      operation: VcsActionOperation,
      label: string,
      execute: (input: {
        readonly thread: EnvironmentScopedThreadShell;
        readonly project: EnvironmentScopedProjectShell;
        readonly cwd: string;
      }) => Promise<T>,
    ): Promise<T | null> => {
      if (!selectedThread || !selectedThreadProject || !selectedThreadCwd) {
        return null;
      }

      const target = {
        environmentId: selectedThread.environmentId,
        cwd: selectedThreadCwd,
      };
      beginVcsAction(target, { operation, label });
      try {
        setPendingConnectionError(null);
        const result = await execute({
          thread: selectedThread,
          project: selectedThreadProject,
          cwd: selectedThreadCwd,
        });
        completeVcsAction(target);
        return result;
      } catch (error) {
        failVcsAction(target, operation, error);
        const message = error instanceof Error ? error.message : "Git action failed.";
        setPendingConnectionError(message);
        showGitActionResult({ type: "error", title: "Git action failed", description: message });
        return null;
      }
    },
    [selectedThread, selectedThreadCwd, selectedThreadProject],
  );

  const refreshSelectedThreadBranches = useCallback(async (): Promise<ReadonlyArray<VcsRef>> => {
    branchState.refresh();
    return dedupeRemoteBranchesWithLocalMatches(branchState.data?.refs ?? []).filter(
      (branch) => !branch.isRemote,
    );
  }, [branchState]);

  const syncSelectedThreadBranchState = useCallback(
    async (input: {
      readonly thread: EnvironmentScopedThreadShell;
      readonly cwd: string;
      readonly nextThreadState?: {
        readonly branch?: string | null;
        readonly worktreePath?: string | null;
      };
    }) => {
      if (input.nextThreadState) {
        await updateThreadGitContext(input.thread, input.nextThreadState);
      }
      branchState.refresh();
      await refreshSelectedThreadGitStatus({ quiet: true, cwd: input.cwd });
    },
    [branchState, refreshSelectedThreadGitStatus, updateThreadGitContext],
  );

  const onCheckoutSelectedThreadBranch = useCallback(
    async (branch: string) => {
      await runSelectedThreadGitMutation(
        "switch_ref",
        "Switching branch",
        async ({ thread, cwd }) => {
          const result = await vcsActions.switchRef({
            environmentId: thread.environmentId,
            input: { cwd, refName: branch },
          });
          await syncSelectedThreadBranchState({
            thread,
            cwd,
            nextThreadState: {
              branch: result.refName ?? thread.branch,
              worktreePath: selectedThreadWorktreePath,
            },
          });
        },
      );
    },
    [
      runSelectedThreadGitMutation,
      selectedThreadWorktreePath,
      syncSelectedThreadBranchState,
      vcsActions,
    ],
  );

  const onCreateSelectedThreadBranch = useCallback(
    async (branch: string) => {
      await runSelectedThreadGitMutation(
        "create_ref",
        "Creating branch",
        async ({ thread, cwd }) => {
          const result = await vcsActions.createRef({
            environmentId: thread.environmentId,
            input: { cwd, refName: branch, switchRef: true },
          });
          await syncSelectedThreadBranchState({
            thread,
            cwd,
            nextThreadState: {
              branch: result.refName ?? thread.branch,
              worktreePath: selectedThreadWorktreePath,
            },
          });
        },
      );
    },
    [
      runSelectedThreadGitMutation,
      selectedThreadWorktreePath,
      syncSelectedThreadBranchState,
      vcsActions,
    ],
  );

  const onCreateSelectedThreadWorktree = useCallback(
    async (nextWorktree: { readonly baseBranch: string; readonly newBranch: string }) => {
      await runSelectedThreadGitMutation(
        "create_worktree",
        "Creating worktree",
        async ({ thread, project }) => {
          const result = await vcsActions.createWorktree({
            environmentId: thread.environmentId,
            input: {
              cwd: project.workspaceRoot,
              refName: nextWorktree.baseBranch,
              newRefName: sanitizeFeatureBranchName(nextWorktree.newBranch),
              path: null,
            },
          });
          await syncSelectedThreadBranchState({
            thread,
            cwd: result.worktree.path,
            nextThreadState: {
              branch: result.worktree.refName,
              worktreePath: result.worktree.path,
            },
          });
        },
      );
    },
    [runSelectedThreadGitMutation, syncSelectedThreadBranchState, vcsActions],
  );

  const onPullSelectedThreadBranch = useCallback(async () => {
    await runSelectedThreadGitMutation(
      "pull",
      "Pulling latest changes",
      async ({ thread, cwd }) => {
        const result = await vcsActions.pull({
          environmentId: thread.environmentId,
          input: { cwd },
        });
        await refreshSelectedThreadGitStatus({ quiet: true, cwd });
        showGitActionResult({
          type: "success",
          title:
            result.status === "skipped_up_to_date"
              ? "Already up to date"
              : `Pulled latest on ${result.refName}`,
        });
      },
    );
  }, [refreshSelectedThreadGitStatus, runSelectedThreadGitMutation, vcsActions]);

  const onRunSelectedThreadGitAction = useCallback(
    async (input: GitActionRequestInput): Promise<GitRunStackedActionResult | null> => {
      return await runSelectedThreadGitMutation(
        "run_change_request",
        "Running source control action",
        async ({ thread, cwd }) => {
          const event = await gitActions.runStackedAction({
            environmentId: thread.environmentId,
            input: {
              cwd,
              actionId: uuidv4(),
              action: input.action,
              ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
              ...(input.featureBranch ? { featureBranch: input.featureBranch } : {}),
              ...(input.filePaths?.length ? { filePaths: [...input.filePaths] } : {}),
            },
          });
          if (event.kind === "action_failed") {
            throw new Error(event.message);
          }
          if (event.kind !== "action_finished") {
            throw new Error("Source control action ended without a result.");
          }

          const result = event.result;
          showGitActionResult({
            type: "success",
            title: result.toast.title,
            description: result.toast.description,
            prUrl: result.toast.cta.kind === "open_pr" ? result.toast.cta.url : undefined,
          });

          if (result.branch.status === "created" && result.branch.name) {
            await syncSelectedThreadBranchState({
              thread,
              cwd,
              nextThreadState: {
                branch: result.branch.name,
                worktreePath: selectedThreadWorktreePath,
              },
            });
          } else {
            await refreshSelectedThreadGitStatus({ quiet: true, cwd });
          }
          return result;
        },
      );
    },
    [
      gitActions,
      refreshSelectedThreadGitStatus,
      runSelectedThreadGitMutation,
      selectedThreadWorktreePath,
      syncSelectedThreadBranchState,
    ],
  );

  return {
    refreshSelectedThreadGitStatus,
    refreshSelectedThreadBranches,
    onCheckoutSelectedThreadBranch,
    onCreateSelectedThreadBranch,
    onCreateSelectedThreadWorktree,
    onPullSelectedThreadBranch,
    onRunSelectedThreadGitAction,
  };
}

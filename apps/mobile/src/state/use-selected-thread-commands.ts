import { useCallback } from "react";

import {
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";

import { useMobileThreadActions } from "../connection/mobileThreadEnvironment";
import { useThreadSelection } from "./use-thread-selection";

export function useSelectedThreadCommands(input: {
  readonly refreshSelectedThreadGitStatus: (options?: {
    readonly quiet?: boolean;
    readonly cwd?: string | null;
  }) => Promise<unknown>;
}) {
  const threadActions = useMobileThreadActions();
  const { refreshSelectedThreadGitStatus } = input;
  const { selectedThread } = useThreadSelection();

  const onRefresh = useCallback(async () => {
    if (selectedThread) {
      await refreshSelectedThreadGitStatus({ quiet: true });
    }
  }, [refreshSelectedThreadGitStatus, selectedThread]);

  const onUpdateThreadModelSelection = useCallback(
    async (modelSelection: ModelSelection) => {
      if (!selectedThread) {
        return;
      }

      await threadActions.updateMetadata({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          modelSelection,
        },
      });
    },
    [threadActions, selectedThread],
  );

  const onUpdateThreadRuntimeMode = useCallback(
    async (runtimeMode: RuntimeMode) => {
      if (!selectedThread) {
        return;
      }

      await threadActions.setRuntimeMode({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          runtimeMode,
        },
      });
    },
    [threadActions, selectedThread],
  );

  const onUpdateThreadInteractionMode = useCallback(
    async (interactionMode: ProviderInteractionMode) => {
      if (!selectedThread) {
        return;
      }

      await threadActions.setInteractionMode({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          interactionMode,
        },
      });
    },
    [threadActions, selectedThread],
  );

  const onStopThread = useCallback(async () => {
    if (!selectedThread) {
      return;
    }

    if (
      selectedThread.session?.status !== "running" &&
      selectedThread.session?.status !== "starting"
    ) {
      return;
    }

    await threadActions.interruptTurn({
      environmentId: selectedThread.environmentId,
      input: {
        threadId: selectedThread.id,
        ...(selectedThread.session?.activeTurnId
          ? { turnId: selectedThread.session.activeTurnId }
          : {}),
      },
    });
  }, [threadActions, selectedThread]);

  const onRenameThread = useCallback(
    async (title: string) => {
      if (!selectedThread) {
        return;
      }

      const trimmed = title.trim();
      if (!trimmed || trimmed === selectedThread.title) {
        return;
      }

      await threadActions.updateMetadata({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          title: trimmed,
        },
      });
    },
    [threadActions, selectedThread],
  );

  return {
    onRefresh,
    onUpdateThreadModelSelection,
    onUpdateThreadRuntimeMode,
    onUpdateThreadInteractionMode,
    onRenameThread,
    onStopThread,
  };
}

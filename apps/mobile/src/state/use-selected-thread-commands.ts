import { useAtomSet } from "@effect/atom-react";
import { useCallback } from "react";

import {
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";

import { threadEnvironment } from "../state/threads";
import { useThreadSelection } from "./use-thread-selection";

export function useSelectedThreadCommands(input: {
  readonly refreshSelectedThreadGitStatus: (options?: {
    readonly quiet?: boolean;
    readonly cwd?: string | null;
  }) => Promise<unknown>;
}) {
  const updateMetadata = useAtomSet(threadEnvironment.updateMetadata, { mode: "promise" });
  const setRuntimeMode = useAtomSet(threadEnvironment.setRuntimeMode, { mode: "promise" });
  const setInteractionMode = useAtomSet(threadEnvironment.setInteractionMode, { mode: "promise" });
  const interruptTurn = useAtomSet(threadEnvironment.interruptTurn, { mode: "promise" });
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

      await updateMetadata({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          modelSelection,
        },
      });
    },
    [selectedThread, updateMetadata],
  );

  const onUpdateThreadRuntimeMode = useCallback(
    async (runtimeMode: RuntimeMode) => {
      if (!selectedThread) {
        return;
      }

      await setRuntimeMode({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          runtimeMode,
        },
      });
    },
    [selectedThread, setRuntimeMode],
  );

  const onUpdateThreadInteractionMode = useCallback(
    async (interactionMode: ProviderInteractionMode) => {
      if (!selectedThread) {
        return;
      }

      await setInteractionMode({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          interactionMode,
        },
      });
    },
    [selectedThread, setInteractionMode],
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

    await interruptTurn({
      environmentId: selectedThread.environmentId,
      input: {
        threadId: selectedThread.id,
        ...(selectedThread.session?.activeTurnId
          ? { turnId: selectedThread.session.activeTurnId }
          : {}),
      },
    });
  }, [interruptTurn, selectedThread]);

  const onRenameThread = useCallback(
    async (title: string) => {
      if (!selectedThread) {
        return;
      }

      const trimmed = title.trim();
      if (!trimmed || trimmed === selectedThread.title) {
        return;
      }

      await updateMetadata({
        environmentId: selectedThread.environmentId,
        input: {
          threadId: selectedThread.id,
          title: trimmed,
        },
      });
    },
    [selectedThread, updateMetadata],
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

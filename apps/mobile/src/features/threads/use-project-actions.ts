import { useCallback } from "react";

import { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";

import { useThreadActions } from "../../state/threads";
import { useThreadShells } from "../../state/entities";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { uuidv4 } from "../../lib/uuid";
import { setPendingConnectionError } from "../../state/use-remote-environment-registry";

function deriveThreadTitleFromPrompt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "New thread";
  }

  const compact = trimmed.replace(/\s+/g, " ");
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}...`;
}

export function useProjectActions() {
  const threadActions = useThreadActions();
  const threads = useThreadShells();

  const onCreateThreadWithOptions = useCallback(
    async (input: {
      readonly project: EnvironmentProject;
      readonly modelSelection: ModelSelection;
      readonly envMode: "local" | "worktree";
      readonly branch: string | null;
      readonly worktreePath: string | null;
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode: ProviderInteractionMode;
      readonly initialMessageText: string;
      readonly initialAttachments: ReadonlyArray<DraftComposerImageAttachment>;
    }) => {
      const metadata = makeTurnCommandMetadata();
      const threadId = ThreadId.make(metadata.threadId);
      const initialMessageText = input.initialMessageText.trim();
      const nextTitle = deriveThreadTitleFromPrompt(input.initialMessageText);

      if (initialMessageText.length === 0) {
        return null;
      }
      if (input.envMode === "worktree" && !input.branch) {
        return null;
      }

      const isWorktree = input.envMode === "worktree";
      await threadActions.startTurn({
        environmentId: input.project.environmentId,
        input: {
          commandId: CommandId.make(metadata.commandId),
          threadId,
          message: {
            messageId: MessageId.make(metadata.messageId),
            role: "user",
            text: initialMessageText,
            attachments: input.initialAttachments,
          },
          modelSelection: input.modelSelection,
          titleSeed: nextTitle,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          bootstrap: {
            createThread: {
              projectId: input.project.id,
              title: nextTitle,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: input.branch,
              worktreePath: isWorktree ? null : input.worktreePath,
              createdAt: metadata.createdAt,
            },
            ...(isWorktree
              ? {
                  prepareWorktree: {
                    projectCwd: input.project.workspaceRoot,
                    baseBranch: input.branch!,
                    branch: buildTemporaryWorktreeBranchName(uuidv4),
                  },
                  runSetupScript: true,
                }
              : {}),
          },
          createdAt: metadata.createdAt,
        },
      });

      return {
        environmentId: input.project.environmentId,
        threadId,
      };
    },
    [threadActions],
  );

  const onCreateThread = useCallback(
    async (project: EnvironmentProject) => {
      const latestProjectThread =
        threads.find(
          (thread) =>
            thread.environmentId === project.environmentId && thread.projectId === project.id,
        ) ?? null;
      const modelSelection =
        project.defaultModelSelection ?? latestProjectThread?.modelSelection ?? null;
      if (!modelSelection) {
        setPendingConnectionError("This project does not have a default model configured yet.");
        return null;
      }

      return await onCreateThreadWithOptions({
        project,
        modelSelection,
        envMode: "local",
        branch: null,
        worktreePath: null,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        initialMessageText: "",
        initialAttachments: [],
      });
    },
    [onCreateThreadWithOptions, threads],
  );

  return {
    onCreateThread,
    onCreateThreadWithOptions,
  };
}

import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  GitActionProgressEvent,
  GitRunStackedActionInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import type { createEnvironmentConnectionAtoms } from "./atoms.ts";
import type { createEnvironmentDataAtoms } from "./dataAtoms.ts";
import type { EnvironmentPresentation } from "./presentation.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "./threads.ts";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("environment-react:empty-result"),
);
const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("environment-react:empty-presentation"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function formatError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

function bindEnvironmentAction<Input, Output>(
  environmentId: EnvironmentId,
  action: (target: { readonly environmentId: EnvironmentId; readonly input: Input }) => Output,
) {
  return (input: Input): Output => action({ environmentId, input });
}

function useQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

export function createEnvironmentReactFacade<CR, CE, DR, DE>(
  connections: ReturnType<typeof createEnvironmentConnectionAtoms<CR, CE>>,
  data: ReturnType<typeof createEnvironmentDataAtoms<DR, DE>>,
) {
  function useConnectionState(environmentId: EnvironmentId) {
    return useQuery(connections.stateAtom(environmentId));
  }

  function useEnvironmentPresentation(environmentId: EnvironmentId | null) {
    const catalog = useAtomValue(connections.catalogValueAtom);
    const presentation = useAtomValue(
      environmentId === null
        ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
        : connections.presentationAtom(environmentId),
    );
    return {
      isReady: catalog.isReady,
      presentation,
    };
  }

  function useEnvironmentConfig(environmentId: EnvironmentId) {
    return useQuery(connections.configAtom(environmentId));
  }

  function usePreparedConnection(environmentId: EnvironmentId) {
    return useAtomValue(connections.preparedConnectionValueAtom(environmentId));
  }

  function useShell(environmentId: EnvironmentId) {
    return useQuery(connections.shellStateAtom(environmentId));
  }

  function useThread(
    environmentId: EnvironmentId | null,
    threadId: ThreadId | null,
  ): EnvironmentThreadState {
    const result = useAtomValue(
      environmentId !== null && threadId !== null
        ? connections.threadStateAtom(environmentId, threadId)
        : EMPTY_ASYNC_RESULT_ATOM,
    );
    return Option.getOrElse(
      AsyncResult.value(result),
      () => EMPTY_ENVIRONMENT_THREAD_STATE,
    ) as EnvironmentThreadState;
  }

  function useFilesystemBrowse(
    target: Parameters<typeof data.queries.filesystemBrowseAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.filesystemBrowseAtom(target));
  }

  function useProjectSearchEntries(
    target: Parameters<typeof data.queries.projectSearchEntriesAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.projectSearchEntriesAtom(target));
  }

  function useVcsListRefs(target: Parameters<typeof data.queries.vcsListRefsAtom>[0] | null) {
    return useQuery(target === null ? null : data.queries.vcsListRefsAtom(target));
  }

  function useVcsStatus(target: Parameters<typeof data.queries.vcsStatusAtom>[0] | null) {
    return useQuery(target === null ? null : data.queries.vcsStatusAtom(target));
  }

  function useReviewDiffPreview(
    target: Parameters<typeof data.queries.reviewDiffPreviewAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.reviewDiffPreviewAtom(target));
  }

  function useServerConfig(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.serverConfigAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useServerSettings(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.serverSettingsAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useSourceControlDiscovery(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.sourceControlDiscoveryAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useTraceDiagnostics(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.traceDiagnosticsAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useProcessDiagnostics(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.processDiagnosticsAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useProcessResourceHistory(
    target: Parameters<typeof data.queries.processResourceHistoryAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.processResourceHistoryAtom(target));
  }

  function useSourceControlRepository(
    target: Parameters<typeof data.queries.sourceControlRepositoryAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.sourceControlRepositoryAtom(target));
  }

  function usePullRequestResolution(
    target: Parameters<typeof data.queries.pullRequestResolutionAtom>[0] | null,
  ) {
    return useQuery(target === null ? null : data.queries.pullRequestResolutionAtom(target));
  }

  function useTurnDiff(target: Parameters<typeof data.queries.turnDiffAtom>[0] | null) {
    return useQuery(target === null ? null : data.queries.turnDiffAtom(target));
  }

  function useFullThreadDiff(target: Parameters<typeof data.queries.fullThreadDiffAtom>[0] | null) {
    return useQuery(target === null ? null : data.queries.fullThreadDiffAtom(target));
  }

  function useArchivedShellSnapshot(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.archivedShellSnapshotAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useRelayClientStatus(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.relayClientStatusAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useTerminalAttach(target: Parameters<typeof data.queries.terminalAttachAtom>[0] | null) {
    return useQuery(target === null ? null : data.queries.terminalAttachAtom(target));
  }

  function useTerminalEvents(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.terminalEventsAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useTerminalMetadata(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.terminalMetadataAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useServerConfigChanges(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.serverConfigChangesAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useServerLifecycleChanges(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.serverLifecycleChangesAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useAuthAccessChanges(environmentId: EnvironmentId | null) {
    return useQuery(
      environmentId === null
        ? null
        : data.queries.authAccessChangesAtom({
            environmentId,
            input: null,
          }),
    );
  }

  function useConnectionActions() {
    const register = useAtomSet(connections.register, { mode: "promise" });
    const remove = useAtomSet(connections.remove, { mode: "promise" });
    const removeRelayEnvironments = useAtomSet(connections.removeRelayEnvironments, {
      mode: "promise",
    });
    const retryNow = useAtomSet(connections.retryNow, { mode: "promise" });
    return useMemo(
      () => ({
        register,
        remove,
        removeRelayEnvironments,
        retryNow,
      }),
      [register, remove, removeRelayEnvironments, retryNow],
    );
  }

  function useRunStackedGitActionState() {
    return useAtomValue(data.mutations.runStackedGitAction) as AsyncResult.AsyncResult<
      GitActionProgressEvent,
      unknown
    >;
  }

  function useActions() {
    const writeProjectFile = useAtomSet(data.mutations.writeProjectFile, {
      mode: "promise",
    });
    const openInEditor = useAtomSet(data.mutations.openInEditor, {
      mode: "promise",
    });
    const pull = useAtomSet(data.mutations.pull, { mode: "promise" });
    const refreshVcsStatus = useAtomSet(data.mutations.refreshVcsStatus, {
      mode: "promise",
    });
    const createWorktree = useAtomSet(data.mutations.createWorktree, {
      mode: "promise",
    });
    const removeWorktree = useAtomSet(data.mutations.removeWorktree, {
      mode: "promise",
    });
    const createRef = useAtomSet(data.mutations.createRef, {
      mode: "promise",
    });
    const switchRef = useAtomSet(data.mutations.switchRef, {
      mode: "promise",
    });
    const initRepository = useAtomSet(data.mutations.initRepository, {
      mode: "promise",
    });
    const runStackedAction = useAtomSet(data.mutations.runStackedGitAction, {
      mode: "promise",
    }) as unknown as (target: {
      readonly environmentId: EnvironmentId;
      readonly input: GitRunStackedActionInput;
    }) => Promise<GitActionProgressEvent>;
    const resolvePullRequest = useAtomSet(data.mutations.resolvePullRequest, { mode: "promise" });
    const preparePullRequestThread = useAtomSet(data.mutations.preparePullRequestThread, {
      mode: "promise",
    });
    const openTerminal = useAtomSet(data.mutations.openTerminal, {
      mode: "promise",
    });
    const writeTerminal = useAtomSet(data.mutations.writeTerminal, {
      mode: "promise",
    });
    const resizeTerminal = useAtomSet(data.mutations.resizeTerminal, {
      mode: "promise",
    });
    const clearTerminal = useAtomSet(data.mutations.clearTerminal, {
      mode: "promise",
    });
    const restartTerminal = useAtomSet(data.mutations.restartTerminal, {
      mode: "promise",
    });
    const closeTerminal = useAtomSet(data.mutations.closeTerminal, {
      mode: "promise",
    });
    const refreshProviders = useAtomSet(data.mutations.refreshProviders, {
      mode: "promise",
    });
    const updateProvider = useAtomSet(data.mutations.updateProvider, {
      mode: "promise",
    });
    const upsertKeybinding = useAtomSet(data.mutations.upsertKeybinding, {
      mode: "promise",
    });
    const removeKeybinding = useAtomSet(data.mutations.removeKeybinding, {
      mode: "promise",
    });
    const updateSettings = useAtomSet(data.mutations.updateSettings, {
      mode: "promise",
    });
    const signalProcess = useAtomSet(data.mutations.signalProcess, {
      mode: "promise",
    });
    const installRelayClient = useAtomSet(data.mutations.installRelayClient, { mode: "promise" });
    const cloneRepository = useAtomSet(data.mutations.cloneRepository, {
      mode: "promise",
    });
    const lookupRepository = useAtomSet(data.mutations.lookupRepository, {
      mode: "promise",
    });
    const publishRepository = useAtomSet(data.mutations.publishRepository, { mode: "promise" });
    const createProject = useAtomSet(data.mutations.createProject, {
      mode: "promise",
    });
    const updateProject = useAtomSet(data.mutations.updateProject, {
      mode: "promise",
    });
    const deleteProject = useAtomSet(data.mutations.deleteProject, {
      mode: "promise",
    });
    const createThread = useAtomSet(data.mutations.createThread, {
      mode: "promise",
    });
    const deleteThread = useAtomSet(data.mutations.deleteThread, {
      mode: "promise",
    });
    const archiveThread = useAtomSet(data.mutations.archiveThread, {
      mode: "promise",
    });
    const unarchiveThread = useAtomSet(data.mutations.unarchiveThread, {
      mode: "promise",
    });
    const updateThreadMetadata = useAtomSet(data.mutations.updateThreadMetadata, {
      mode: "promise",
    });
    const setThreadRuntimeMode = useAtomSet(data.mutations.setThreadRuntimeMode, {
      mode: "promise",
    });
    const setThreadInteractionMode = useAtomSet(data.mutations.setThreadInteractionMode, {
      mode: "promise",
    });
    const startThreadTurn = useAtomSet(data.mutations.startThreadTurn, {
      mode: "promise",
    });
    const interruptThreadTurn = useAtomSet(data.mutations.interruptThreadTurn, { mode: "promise" });
    const respondToThreadApproval = useAtomSet(data.mutations.respondToThreadApproval, {
      mode: "promise",
    });
    const respondToThreadUserInput = useAtomSet(data.mutations.respondToThreadUserInput, {
      mode: "promise",
    });
    const revertThreadCheckpoint = useAtomSet(data.mutations.revertThreadCheckpoint, {
      mode: "promise",
    });
    const stopThreadSession = useAtomSet(data.mutations.stopThreadSession, { mode: "promise" });
    const replayEvents = useAtomSet(data.mutations.replayEvents, {
      mode: "promise",
    });

    return useMemo(
      () => ({
        projects: {
          create: createProject,
          update: updateProject,
          delete: deleteProject,
          writeFile: writeProjectFile,
        },
        threads: {
          create: createThread,
          delete: deleteThread,
          archive: archiveThread,
          unarchive: unarchiveThread,
          updateMetadata: updateThreadMetadata,
          setRuntimeMode: setThreadRuntimeMode,
          setInteractionMode: setThreadInteractionMode,
          startTurn: startThreadTurn,
          interruptTurn: interruptThreadTurn,
          respondToApproval: respondToThreadApproval,
          respondToUserInput: respondToThreadUserInput,
          revertCheckpoint: revertThreadCheckpoint,
          stopSession: stopThreadSession,
        },
        shell: { openInEditor },
        vcs: {
          pull,
          refreshStatus: refreshVcsStatus,
          createWorktree,
          removeWorktree,
          createRef,
          switchRef,
          init: initRepository,
        },
        git: {
          runStackedAction,
          resolvePullRequest,
          preparePullRequestThread,
        },
        terminal: {
          open: openTerminal,
          write: writeTerminal,
          resize: resizeTerminal,
          clear: clearTerminal,
          restart: restartTerminal,
          close: closeTerminal,
        },
        server: {
          refreshProviders,
          updateProvider,
          upsertKeybinding,
          removeKeybinding,
          updateSettings,
          signalProcess,
        },
        cloud: { installRelayClient },
        sourceControl: {
          lookupRepository,
          cloneRepository,
          publishRepository,
        },
        orchestration: { replayEvents },
      }),
      [
        archiveThread,
        clearTerminal,
        cloneRepository,
        closeTerminal,
        createProject,
        createRef,
        createThread,
        createWorktree,
        deleteProject,
        deleteThread,
        initRepository,
        installRelayClient,
        interruptThreadTurn,
        lookupRepository,
        openInEditor,
        openTerminal,
        preparePullRequestThread,
        publishRepository,
        pull,
        refreshProviders,
        refreshVcsStatus,
        removeKeybinding,
        removeWorktree,
        replayEvents,
        resizeTerminal,
        resolvePullRequest,
        respondToThreadApproval,
        respondToThreadUserInput,
        restartTerminal,
        revertThreadCheckpoint,
        runStackedAction,
        setThreadInteractionMode,
        setThreadRuntimeMode,
        signalProcess,
        startThreadTurn,
        stopThreadSession,
        switchRef,
        unarchiveThread,
        updateProject,
        updateProvider,
        updateSettings,
        updateThreadMetadata,
        upsertKeybinding,
        writeProjectFile,
        writeTerminal,
      ],
    );
  }

  function useEnvironmentActions(environmentId: EnvironmentId) {
    const actions = useActions();
    return useMemo(
      () => ({
        projects: {
          create: bindEnvironmentAction(environmentId, actions.projects.create),
          update: bindEnvironmentAction(environmentId, actions.projects.update),
          delete: bindEnvironmentAction(environmentId, actions.projects.delete),
          writeFile: bindEnvironmentAction(environmentId, actions.projects.writeFile),
        },
        threads: {
          create: bindEnvironmentAction(environmentId, actions.threads.create),
          delete: bindEnvironmentAction(environmentId, actions.threads.delete),
          archive: bindEnvironmentAction(environmentId, actions.threads.archive),
          unarchive: bindEnvironmentAction(environmentId, actions.threads.unarchive),
          updateMetadata: bindEnvironmentAction(environmentId, actions.threads.updateMetadata),
          setRuntimeMode: bindEnvironmentAction(environmentId, actions.threads.setRuntimeMode),
          setInteractionMode: bindEnvironmentAction(
            environmentId,
            actions.threads.setInteractionMode,
          ),
          startTurn: bindEnvironmentAction(environmentId, actions.threads.startTurn),
          interruptTurn: bindEnvironmentAction(environmentId, actions.threads.interruptTurn),
          respondToApproval: bindEnvironmentAction(
            environmentId,
            actions.threads.respondToApproval,
          ),
          respondToUserInput: bindEnvironmentAction(
            environmentId,
            actions.threads.respondToUserInput,
          ),
          revertCheckpoint: bindEnvironmentAction(environmentId, actions.threads.revertCheckpoint),
          stopSession: bindEnvironmentAction(environmentId, actions.threads.stopSession),
        },
        shell: {
          openInEditor: bindEnvironmentAction(environmentId, actions.shell.openInEditor),
        },
        vcs: {
          pull: bindEnvironmentAction(environmentId, actions.vcs.pull),
          refreshStatus: bindEnvironmentAction(environmentId, actions.vcs.refreshStatus),
          createWorktree: bindEnvironmentAction(environmentId, actions.vcs.createWorktree),
          removeWorktree: bindEnvironmentAction(environmentId, actions.vcs.removeWorktree),
          createRef: bindEnvironmentAction(environmentId, actions.vcs.createRef),
          switchRef: bindEnvironmentAction(environmentId, actions.vcs.switchRef),
          init: bindEnvironmentAction(environmentId, actions.vcs.init),
        },
        git: {
          runStackedAction: bindEnvironmentAction(environmentId, actions.git.runStackedAction),
          resolvePullRequest: bindEnvironmentAction(environmentId, actions.git.resolvePullRequest),
          preparePullRequestThread: bindEnvironmentAction(
            environmentId,
            actions.git.preparePullRequestThread,
          ),
        },
        terminal: {
          open: bindEnvironmentAction(environmentId, actions.terminal.open),
          write: bindEnvironmentAction(environmentId, actions.terminal.write),
          resize: bindEnvironmentAction(environmentId, actions.terminal.resize),
          clear: bindEnvironmentAction(environmentId, actions.terminal.clear),
          restart: bindEnvironmentAction(environmentId, actions.terminal.restart),
          close: bindEnvironmentAction(environmentId, actions.terminal.close),
        },
        server: {
          refreshProviders: bindEnvironmentAction(environmentId, actions.server.refreshProviders),
          updateProvider: bindEnvironmentAction(environmentId, actions.server.updateProvider),
          upsertKeybinding: bindEnvironmentAction(environmentId, actions.server.upsertKeybinding),
          removeKeybinding: bindEnvironmentAction(environmentId, actions.server.removeKeybinding),
          updateSettings: bindEnvironmentAction(environmentId, actions.server.updateSettings),
          signalProcess: bindEnvironmentAction(environmentId, actions.server.signalProcess),
        },
        cloud: {
          installRelayClient: bindEnvironmentAction(
            environmentId,
            actions.cloud.installRelayClient,
          ),
        },
        sourceControl: {
          lookupRepository: bindEnvironmentAction(
            environmentId,
            actions.sourceControl.lookupRepository,
          ),
          cloneRepository: bindEnvironmentAction(
            environmentId,
            actions.sourceControl.cloneRepository,
          ),
          publishRepository: bindEnvironmentAction(
            environmentId,
            actions.sourceControl.publishRepository,
          ),
        },
        orchestration: {
          replayEvents: bindEnvironmentAction(environmentId, actions.orchestration.replayEvents),
        },
      }),
      [actions, environmentId],
    );
  }

  return {
    useConnectionState,
    useEnvironmentPresentation,
    useEnvironmentConfig,
    usePreparedConnection,
    useShell,
    useThread,
    useFilesystemBrowse,
    useProjectSearchEntries,
    useVcsListRefs,
    useVcsStatus,
    useReviewDiffPreview,
    useServerConfig,
    useServerSettings,
    useSourceControlDiscovery,
    useTraceDiagnostics,
    useProcessDiagnostics,
    useProcessResourceHistory,
    useSourceControlRepository,
    usePullRequestResolution,
    useTurnDiff,
    useFullThreadDiff,
    useArchivedShellSnapshot,
    useRelayClientStatus,
    useTerminalAttach,
    useTerminalEvents,
    useTerminalMetadata,
    useServerConfigChanges,
    useServerLifecycleChanges,
    useAuthAccessChanges,
    useConnectionActions,
    useRunStackedGitActionState,
    useActions,
    useEnvironmentActions,
  };
}

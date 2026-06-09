import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import { ThreadId, type EnvironmentId, type TerminalAttachInput } from "@t3tools/contracts";
import { useAtomSet } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const attach = useEnvironmentQuery(
    input.environmentId !== null && input.terminal !== null
      ? terminalEnvironment.attach({
          environmentId: input.environmentId,
          input: input.terminal,
        })
      : null,
  );
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_TERMINAL_SESSION_STATE;
    }
    const summary =
      metadata.data?.find(
        (terminal) =>
          terminal.threadId === input.terminal?.threadId &&
          terminal.terminalId === input.terminal?.terminalId,
      ) ?? null;
    const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, input.environmentId, input.terminal, metadata.data]);
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> {
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  return useMemo(() => {
    if (input.environmentId === null) {
      return [];
    }
    return (metadata.data ?? [])
      .filter((summary) => input.threadId === null || summary.threadId === input.threadId)
      .map((summary) => ({
        target: {
          environmentId: input.environmentId!,
          threadId: ThreadId.make(summary.threadId),
          terminalId: summary.terminalId,
        },
        state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
      }))
      .sort((left, right) =>
        left.target.terminalId.localeCompare(right.target.terminalId, undefined, {
          numeric: true,
        }),
      );
  }, [input.environmentId, input.threadId, metadata.data]);
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<string> {
  return useKnownTerminalSessions(input)
    .filter((session) => session.state.status === "running")
    .map((session) => session.target.terminalId);
}

export function useTerminalController(input: {
  readonly environmentId: EnvironmentId;
  readonly terminal: TerminalAttachInput;
}) {
  const writeTerminal = useAtomSet(terminalEnvironment.write, { mode: "promise" });
  const resizeTerminal = useAtomSet(terminalEnvironment.resize, { mode: "promise" });
  const clearTerminal = useAtomSet(terminalEnvironment.clear, { mode: "promise" });
  const restartTerminal = useAtomSet(terminalEnvironment.restart, { mode: "promise" });
  const closeTerminal = useAtomSet(terminalEnvironment.close, { mode: "promise" });
  const session = useAttachedTerminalSession(input);
  const { environmentId, terminal } = input;

  const write = useCallback(
    (data: string) =>
      writeTerminal({
        environmentId,
        input: {
          threadId: terminal.threadId,
          terminalId: terminal.terminalId,
          data,
        },
      }),
    [environmentId, terminal.terminalId, terminal.threadId, writeTerminal],
  );
  const resize = useCallback(
    (cols: number, rows: number) =>
      resizeTerminal({
        environmentId,
        input: {
          threadId: terminal.threadId,
          terminalId: terminal.terminalId,
          cols,
          rows,
        },
      }),
    [environmentId, resizeTerminal, terminal.terminalId, terminal.threadId],
  );
  const clear = useCallback(
    () =>
      clearTerminal({
        environmentId,
        input: {
          threadId: terminal.threadId,
          terminalId: terminal.terminalId,
        },
      }),
    [clearTerminal, environmentId, terminal.terminalId, terminal.threadId],
  );
  const restart = useCallback(() => {
    if (terminal.cwd === undefined || terminal.cols === undefined || terminal.rows === undefined) {
      return Promise.reject(
        new Error("Terminal restart requires the working directory and dimensions."),
      );
    }
    return restartTerminal({
      environmentId,
      input: {
        threadId: terminal.threadId,
        terminalId: terminal.terminalId,
        cwd: terminal.cwd,
        cols: terminal.cols,
        rows: terminal.rows,
        ...(terminal.worktreePath !== undefined ? { worktreePath: terminal.worktreePath } : {}),
        ...(terminal.env !== undefined ? { env: terminal.env } : {}),
      },
    });
  }, [environmentId, restartTerminal, terminal]);
  const close = useCallback(
    (options?: { readonly deleteHistory?: boolean }) =>
      closeTerminal({
        environmentId,
        input: {
          threadId: terminal.threadId,
          terminalId: terminal.terminalId,
          ...(options?.deleteHistory ? { deleteHistory: true } : {}),
        },
      }),
    [closeTerminal, environmentId, terminal.terminalId, terminal.threadId],
  );

  return {
    session,
    write,
    resize,
    clear,
    restart,
    close,
  };
}

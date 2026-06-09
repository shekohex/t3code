import { useAtomValue } from "@effect/atom-react";
import {
  applyVcsActionProgressEvent,
  EMPTY_VCS_ACTION_ATOM,
  EMPTY_VCS_ACTION_STATE,
  getVcsActionTargetKey,
  type VcsActionState,
  type VcsActionTarget,
  vcsActionStateAtom,
} from "@t3tools/client-runtime/state/vcs";
import type { GitActionProgressEvent } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { useRunStackedGitActionState } from "../connection/useEnvironmentData";
import { appAtomRegistry } from "./atom-registry";

function setVcsActionState(target: VcsActionTarget, state: VcsActionState): void {
  const targetKey = getVcsActionTargetKey(target);
  if (targetKey !== null) {
    appAtomRegistry.set(vcsActionStateAtom(targetKey), state);
  }
}

export function beginVcsAction(
  target: VcsActionTarget,
  input: {
    readonly operation: VcsActionState["operation"];
    readonly label: string;
  },
): void {
  setVcsActionState(target, {
    ...EMPTY_VCS_ACTION_STATE,
    isRunning: true,
    operation: input.operation,
    currentLabel: input.label,
    currentPhaseLabel: input.label,
    phaseStartedAtMs: Date.now(),
  });
}

export function completeVcsAction(target: VcsActionTarget): void {
  setVcsActionState(target, EMPTY_VCS_ACTION_STATE);
}

export function failVcsAction(
  target: VcsActionTarget,
  operation: VcsActionState["operation"],
  error: unknown,
): void {
  setVcsActionState(target, {
    ...EMPTY_VCS_ACTION_STATE,
    operation,
    error: error instanceof Error ? error.message : "Source control action failed.",
  });
}

export function useVcsActionState(target: VcsActionTarget): VcsActionState {
  const targetKey = getVcsActionTargetKey(target);
  const runStackedActionState = useRunStackedGitActionState();
  const state = useAtomValue(
    targetKey !== null ? vcsActionStateAtom(targetKey) : EMPTY_VCS_ACTION_ATOM,
  );

  useEffect(() => {
    const event = Option.getOrNull(AsyncResult.value(runStackedActionState));
    if (event === null || targetKey === null || event.cwd !== target.cwd) {
      return;
    }
    appAtomRegistry.set(
      vcsActionStateAtom(targetKey),
      applyVcsActionProgressEvent(
        appAtomRegistry.get(vcsActionStateAtom(targetKey)),
        event as GitActionProgressEvent,
      ),
    );
  }, [runStackedActionState, target.cwd, targetKey]);

  return targetKey === null ? EMPTY_VCS_ACTION_STATE : state;
}

export interface GitActionResultNotification {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description?: string;
  readonly prUrl?: string;
}

const RESULT_DISMISS_MS = 5_000;

type ResultListener = (result: GitActionResultNotification | null) => void;
const resultListeners = new Set<ResultListener>();
let currentResult: GitActionResultNotification | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function broadcast(result: GitActionResultNotification | null): void {
  currentResult = result;
  for (const listener of resultListeners) {
    listener(result);
  }
}

export function showGitActionResult(result: GitActionResultNotification): void {
  if (dismissTimer) clearTimeout(dismissTimer);
  broadcast(result);
  dismissTimer = setTimeout(() => broadcast(null), RESULT_DISMISS_MS);
}

export function dismissGitActionResult(): void {
  if (dismissTimer) clearTimeout(dismissTimer);
  broadcast(null);
}

export function useGitActionResultNotification(): {
  readonly result: GitActionResultNotification | null;
  readonly dismiss: () => void;
} {
  const [result, setResult] = useState<GitActionResultNotification | null>(currentResult);

  useEffect(() => {
    resultListeners.add(setResult);
    setResult(currentResult);
    return () => {
      resultListeners.delete(setResult);
    };
  }, []);

  return { result, dismiss: dismissGitActionResult };
}

export type GitActionProgressPhase = "idle" | "running" | "success" | "error";

export interface GitActionProgress {
  readonly phase: GitActionProgressPhase;
  readonly label: string | null;
  readonly description: string | null;
  readonly prUrl?: string;
}

const EMPTY_PROGRESS: GitActionProgress = {
  phase: "idle",
  label: null,
  description: null,
};

function formatElapsedSeconds(ms: number | null): string | null {
  if (ms === null) return null;
  const elapsed = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (elapsed < 2) return null;
  return `Running for ${elapsed}s`;
}

export function useGitActionProgress(target: VcsActionTarget): GitActionProgress {
  const actionState = useVcsActionState(target);
  const { result } = useGitActionResultNotification();

  const [, forceUpdate] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startElapsedTimer = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => forceUpdate((n) => n + 1), 1000);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (actionState.isRunning) {
      startElapsedTimer();
    } else {
      stopElapsedTimer();
    }
    return stopElapsedTimer;
  }, [actionState.isRunning, startElapsedTimer, stopElapsedTimer]);

  if (actionState.isRunning) {
    const description =
      actionState.lastOutputLine ??
      formatElapsedSeconds(actionState.hookStartedAtMs ?? actionState.phaseStartedAtMs);
    return {
      phase: "running",
      label: actionState.currentLabel,
      description,
    };
  }

  if (result) {
    return {
      phase: result.type,
      label: result.title,
      description: result.description ?? null,
      prUrl: result.prUrl,
    };
  }

  return EMPTY_PROGRESS;
}

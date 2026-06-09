import type { EnvironmentId, GitActionProgressEvent, GitStackedAction } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/unstable/reactivity";

export type VcsActionOperation =
  | "refresh_status"
  | "run_change_request"
  | "pull"
  | "switch_ref"
  | "create_ref"
  | "create_worktree"
  | "init";

export interface VcsActionState {
  readonly isRunning: boolean;
  readonly operation: VcsActionOperation | null;
  readonly actionId: string | null;
  readonly action: GitStackedAction | null;
  readonly currentLabel: string | null;
  readonly currentPhaseLabel: string | null;
  readonly hookName: string | null;
  readonly lastOutputLine: string | null;
  readonly phaseStartedAtMs: number | null;
  readonly hookStartedAtMs: number | null;
  readonly error: string | null;
}

export interface VcsActionTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}

export const EMPTY_VCS_ACTION_STATE = Object.freeze<VcsActionState>({
  isRunning: false,
  operation: null,
  actionId: null,
  action: null,
  currentLabel: null,
  currentPhaseLabel: null,
  hookName: null,
  lastOutputLine: null,
  phaseStartedAtMs: null,
  hookStartedAtMs: null,
  error: null,
});

const nowMs = (): number => DateTime.toEpochMillis(DateTime.nowUnsafe());

export const vcsActionStateAtom = Atom.family((key: string) => {
  return Atom.make(EMPTY_VCS_ACTION_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`vcs-action:${key}`),
  );
});

export const EMPTY_VCS_ACTION_ATOM = Atom.make(EMPTY_VCS_ACTION_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("vcs-action:null"),
);

export function getVcsActionTargetKey(target: VcsActionTarget): string | null {
  if (target.environmentId === null || target.cwd === null) {
    return null;
  }
  return `${target.environmentId}:${target.cwd}`;
}

export function applyVcsActionProgressEvent(
  current: VcsActionState,
  event: GitActionProgressEvent,
): VcsActionState {
  const now = nowMs();

  switch (event.kind) {
    case "action_started":
      return {
        ...current,
        isRunning: true,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        phaseStartedAtMs: now,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        error: null,
      };
    case "phase_started":
      return {
        ...current,
        isRunning: true,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        currentLabel: event.label,
        currentPhaseLabel: event.label,
        phaseStartedAtMs: now,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        error: null,
      };
    case "hook_started":
      return {
        ...current,
        isRunning: true,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        currentLabel: `Running ${event.hookName}...`,
        hookName: event.hookName,
        hookStartedAtMs: now,
        lastOutputLine: null,
        error: null,
      };
    case "hook_output":
      return {
        ...current,
        isRunning: true,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        lastOutputLine: event.text,
        error: null,
      };
    case "hook_finished":
      return {
        ...current,
        isRunning: true,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        currentLabel: current.currentPhaseLabel,
        hookName: null,
        hookStartedAtMs: null,
        lastOutputLine: null,
        error: null,
      };
    case "action_finished":
      return {
        ...current,
        isRunning: false,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        error: null,
      };
    case "action_failed":
      return {
        ...EMPTY_VCS_ACTION_STATE,
        actionId: event.actionId,
        action: event.action,
        operation: "run_change_request",
        error: event.message,
      };
  }
}

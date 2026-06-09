import { EnvironmentId, type GitActionProgressEvent } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  applyVcsActionProgressEvent,
  EMPTY_VCS_ACTION_STATE,
  getVcsActionTargetKey,
} from "./vcsAction.ts";

const actionId = "action-123";
const action = "commit_push" as const;
const cwd = "/repo";

function progress<T extends GitActionProgressEvent>(event: T): T {
  return event;
}

describe("vcsActionState", () => {
  it("projects phase and hook progress without owning the async operation", () => {
    const phase = applyVcsActionProgressEvent(
      EMPTY_VCS_ACTION_STATE,
      progress({
        actionId,
        action,
        cwd,
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      }),
    );
    const hook = applyVcsActionProgressEvent(
      phase,
      progress({
        actionId,
        action,
        cwd,
        kind: "hook_started",
        hookName: "post-commit",
      }),
    );
    const output = applyVcsActionProgressEvent(
      hook,
      progress({
        actionId,
        action,
        cwd,
        kind: "hook_output",
        hookName: "post-commit",
        stream: "stdout",
        text: "hook output",
      }),
    );
    const finished = applyVcsActionProgressEvent(
      output,
      progress({
        actionId,
        action,
        cwd,
        kind: "hook_finished",
        hookName: "post-commit",
        exitCode: 0,
        durationMs: 12,
      }),
    );

    expect(phase).toMatchObject({
      isRunning: true,
      currentLabel: "Committing...",
      currentPhaseLabel: "Committing...",
    });
    expect(output).toMatchObject({
      currentLabel: "Running post-commit...",
      hookName: "post-commit",
      lastOutputLine: "hook output",
    });
    expect(finished).toMatchObject({
      currentLabel: "Committing...",
      hookName: null,
      lastOutputLine: null,
    });
  });

  it("retains a terminal action error for presentation", () => {
    const failed = applyVcsActionProgressEvent(
      EMPTY_VCS_ACTION_STATE,
      progress({
        actionId,
        action,
        cwd,
        kind: "action_failed",
        phase: null,
        message: "Push failed.",
      }),
    );

    expect(failed).toMatchObject({
      isRunning: false,
      operation: "run_change_request",
      actionId,
      action,
      error: "Push failed.",
    });
  });

  it("keys presentation state only when the environment and repository are known", () => {
    expect(
      getVcsActionTargetKey({
        environmentId: EnvironmentId.make("environment-1"),
        cwd,
      }),
    ).toBe(`environment-1:${cwd}`);
    expect(getVcsActionTargetKey({ environmentId: null, cwd })).toBeNull();
    expect(
      getVcsActionTargetKey({
        environmentId: EnvironmentId.make("environment-1"),
        cwd: null,
      }),
    ).toBeNull();
  });
});

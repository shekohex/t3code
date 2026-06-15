import { EnvironmentId, type GitActionProgressEvent } from "@t3tools/contracts";
import { describe, expect, it, vi } from "@effect/vitest";

import { createGitActionTransportId, deliverGitActionProgress } from "./sourceControlActions";

const cwd = "/workspace";
const actionId = "shared-action-id";

function progress(actionId: string): GitActionProgressEvent {
  return {
    actionId,
    action: "commit_push",
    cwd,
    kind: "phase_started",
    phase: "push",
    label: "Pushing...",
  };
}

describe("source control action progress isolation", () => {
  it("does not deliver same-cwd progress across environments", () => {
    const environmentA = EnvironmentId.make("environment-a");
    const environmentB = EnvironmentId.make("environment-b");
    const transportActionA = createGitActionTransportId(environmentA, actionId);
    const transportActionB = createGitActionTransportId(environmentB, actionId);
    const onProgressA = vi.fn();
    const onProgressB = vi.fn();
    const event = progress(transportActionB);

    deliverGitActionProgress(
      {
        transportActionId: transportActionA,
        actionId,
        cwd,
        onProgress: onProgressA,
      },
      event,
    );
    deliverGitActionProgress(
      {
        transportActionId: transportActionB,
        actionId,
        cwd,
        onProgress: onProgressB,
      },
      event,
    );

    expect(onProgressA).not.toHaveBeenCalled();
    expect(onProgressB).toHaveBeenCalledOnce();
    expect(onProgressB).toHaveBeenCalledWith({
      ...event,
      actionId,
    });
  });
});

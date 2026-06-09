import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  GitActionProgressEvent,
  GitRunStackedActionInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webGitEnvironment = createGitEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebPullRequestResolution(
  target: Parameters<typeof webGitEnvironment.pullRequestResolution>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webGitEnvironment.pullRequestResolution(target),
  );
}

export function useWebRunStackedGitActionState() {
  return useAtomValue(webGitEnvironment.runStackedAction) as AsyncResult.AsyncResult<
    GitActionProgressEvent,
    unknown
  >;
}

export function useWebGitActions() {
  return {
    runStackedAction: useAtomSet(webGitEnvironment.runStackedAction, {
      mode: "promise",
    }) as unknown as (target: {
      readonly environmentId: EnvironmentId;
      readonly input: GitRunStackedActionInput;
    }) => Promise<GitActionProgressEvent>,
    resolvePullRequest: useAtomSet(webGitEnvironment.resolvePullRequest, { mode: "promise" }),
    preparePullRequestThread: useAtomSet(webGitEnvironment.preparePullRequestThread, {
      mode: "promise",
    }),
  };
}

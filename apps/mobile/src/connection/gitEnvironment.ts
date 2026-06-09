import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime/state/git";
import type {
  EnvironmentId,
  GitActionProgressEvent,
  GitRunStackedActionInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const gitEnvironment = createGitEnvironmentAtoms(connectionAtomRuntime);

export function usePullRequestResolution(
  target: Parameters<typeof gitEnvironment.pullRequestResolution>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : gitEnvironment.pullRequestResolution(target));
}

export function useRunStackedGitActionState() {
  return useAtomValue(gitEnvironment.runStackedAction) as AsyncResult.AsyncResult<
    GitActionProgressEvent,
    unknown
  >;
}

export function useGitActions() {
  return {
    runStackedAction: useAtomSet(gitEnvironment.runStackedAction, {
      mode: "promise",
    }) as unknown as (target: {
      readonly environmentId: EnvironmentId;
      readonly input: GitRunStackedActionInput;
    }) => Promise<GitActionProgressEvent>,
    resolvePullRequest: useAtomSet(gitEnvironment.resolvePullRequest, {
      mode: "promise",
    }),
    preparePullRequestThread: useAtomSet(gitEnvironment.preparePullRequestThread, {
      mode: "promise",
    }),
  };
}

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  GitActionProgressEvent,
  GitRunStackedActionInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileGitEnvironment = createGitEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobilePullRequestResolution(
  target: Parameters<typeof mobileGitEnvironment.pullRequestResolution>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileGitEnvironment.pullRequestResolution(target),
  );
}

export function useMobileRunStackedGitActionState() {
  return useAtomValue(mobileGitEnvironment.runStackedAction) as AsyncResult.AsyncResult<
    GitActionProgressEvent,
    unknown
  >;
}

export function useMobileGitActions() {
  return {
    runStackedAction: useAtomSet(mobileGitEnvironment.runStackedAction, {
      mode: "promise",
    }) as unknown as (target: {
      readonly environmentId: EnvironmentId;
      readonly input: GitRunStackedActionInput;
    }) => Promise<GitActionProgressEvent>,
    resolvePullRequest: useAtomSet(mobileGitEnvironment.resolvePullRequest, {
      mode: "promise",
    }),
    preparePullRequestThread: useAtomSet(mobileGitEnvironment.preparePullRequestThread, {
      mode: "promise",
    }),
  };
}

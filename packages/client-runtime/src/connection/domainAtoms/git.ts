import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcMutation,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcStreamMutation,
} from "../atoms.ts";
import type { EnvironmentRegistry } from "../registry.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    runStackedAction: createEnvironmentRpcStreamMutation(runtime, {
      label: "environment-data:git:run-stacked-action",
      tag: WS_METHODS.gitRunStackedAction,
    }),
    resolvePullRequest: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    preparePullRequestThread: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
    }),
  };
}

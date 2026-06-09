import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webReviewEnvironment = createReviewEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebReviewDiffPreview(
  target: Parameters<typeof webReviewEnvironment.diffPreview>[0] | null,
) {
  return useWebEnvironmentQuery(target === null ? null : webReviewEnvironment.diffPreview(target));
}

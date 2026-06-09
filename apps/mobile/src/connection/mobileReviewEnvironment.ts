import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileReviewEnvironment = createReviewEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileReviewDiffPreview(
  target: Parameters<typeof mobileReviewEnvironment.diffPreview>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileReviewEnvironment.diffPreview(target),
  );
}

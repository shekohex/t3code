import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/review";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const reviewEnvironment = createReviewEnvironmentAtoms(connectionAtomRuntime);

export function useReviewDiffPreview(
  target: Parameters<typeof reviewEnvironment.diffPreview>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : reviewEnvironment.diffPreview(target));
}

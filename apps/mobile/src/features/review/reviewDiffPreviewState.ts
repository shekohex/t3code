import type { EnvironmentId } from "@t3tools/contracts";

import { useReviewPreview } from "../../state/queries";

export function useReviewDiffPreview(input: {
  readonly environmentId?: EnvironmentId;
  readonly cwd: string | null;
}) {
  return useReviewPreview({
    environmentId: input.environmentId ?? null,
    cwd: input.cwd,
  });
}

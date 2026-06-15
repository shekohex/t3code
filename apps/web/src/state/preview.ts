import { useAtomSet } from "@effect/atom-react";
import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/preview";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";

export const previewEnvironment = createPreviewEnvironmentAtoms(connectionAtomRuntime);

export function usePreviewActions() {
  const open = useAtomSet(previewEnvironment.open, { mode: "promise" });
  const navigate = useAtomSet(previewEnvironment.navigate, { mode: "promise" });
  const refresh = useAtomSet(previewEnvironment.refresh, { mode: "promise" });
  const close = useAtomSet(previewEnvironment.close, { mode: "promise" });
  const reportStatus = useAtomSet(previewEnvironment.reportStatus, { mode: "promise" });
  const respondToAutomation = useAtomSet(previewEnvironment.respondToAutomation, {
    mode: "promise",
  });
  const reportAutomationOwner = useAtomSet(previewEnvironment.reportAutomationOwner, {
    mode: "promise",
  });
  const clearAutomationOwner = useAtomSet(previewEnvironment.clearAutomationOwner, {
    mode: "promise",
  });

  return useMemo(
    () => ({
      open,
      navigate,
      refresh,
      close,
      reportStatus,
      respondToAutomation,
      reportAutomationOwner,
      clearAutomationOwner,
    }),
    [
      clearAutomationOwner,
      close,
      navigate,
      open,
      refresh,
      reportAutomationOwner,
      reportStatus,
      respondToAutomation,
    ],
  );
}

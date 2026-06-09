import { useAtomSet } from "@effect/atom-react";
import { createShellEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";

const mobileShellEnvironment = createShellEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileShellActions() {
  return {
    openInEditor: useAtomSet(mobileShellEnvironment.openInEditor, { mode: "promise" }),
  };
}

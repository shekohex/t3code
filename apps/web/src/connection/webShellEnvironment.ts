import { useAtomSet } from "@effect/atom-react";
import { createShellEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";

const webShellEnvironment = createShellEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebShellActions() {
  return {
    openInEditor: useAtomSet(webShellEnvironment.openInEditor, { mode: "promise" }),
  };
}

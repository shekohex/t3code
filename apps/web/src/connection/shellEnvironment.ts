import { useAtomSet } from "@effect/atom-react";
import { createShellEnvironmentAtoms } from "@t3tools/client-runtime/state/shell";

import { connectionAtomRuntime } from "./connectionRuntime";

const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);

export function useShellActions() {
  return {
    openInEditor: useAtomSet(shellEnvironment.openInEditor, { mode: "promise" }),
  };
}

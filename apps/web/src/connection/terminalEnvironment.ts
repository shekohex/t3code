import { useAtomSet } from "@effect/atom-react";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const terminalEnvironment = createTerminalEnvironmentAtoms(connectionAtomRuntime);

export function useTerminalAttach(target: Parameters<typeof terminalEnvironment.attach>[0] | null) {
  return useEnvironmentQuery(target === null ? null : terminalEnvironment.attach(target));
}

export function useTerminalEvents(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : terminalEnvironment.events({ environmentId, input: {} }),
  );
}

export function useTerminalMetadata(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : terminalEnvironment.metadata({ environmentId, input: null }),
  );
}

export function useTerminalActions() {
  return {
    open: useAtomSet(terminalEnvironment.open, { mode: "promise" }),
    write: useAtomSet(terminalEnvironment.write, { mode: "promise" }),
    resize: useAtomSet(terminalEnvironment.resize, { mode: "promise" }),
    clear: useAtomSet(terminalEnvironment.clear, { mode: "promise" }),
    restart: useAtomSet(terminalEnvironment.restart, { mode: "promise" }),
    close: useAtomSet(terminalEnvironment.close, { mode: "promise" }),
  };
}

import { useAtomSet } from "@effect/atom-react";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webTerminalEnvironment = createTerminalEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebTerminalAttach(
  target: Parameters<typeof webTerminalEnvironment.attach>[0] | null,
) {
  return useWebEnvironmentQuery(target === null ? null : webTerminalEnvironment.attach(target));
}

export function useWebTerminalEvents(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null ? null : webTerminalEnvironment.events({ environmentId, input: {} }),
  );
}

export function useWebTerminalMetadata(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null ? null : webTerminalEnvironment.metadata({ environmentId, input: null }),
  );
}

export function useWebTerminalActions() {
  return {
    open: useAtomSet(webTerminalEnvironment.open, { mode: "promise" }),
    write: useAtomSet(webTerminalEnvironment.write, { mode: "promise" }),
    resize: useAtomSet(webTerminalEnvironment.resize, { mode: "promise" }),
    clear: useAtomSet(webTerminalEnvironment.clear, { mode: "promise" }),
    restart: useAtomSet(webTerminalEnvironment.restart, { mode: "promise" }),
    close: useAtomSet(webTerminalEnvironment.close, { mode: "promise" }),
  };
}

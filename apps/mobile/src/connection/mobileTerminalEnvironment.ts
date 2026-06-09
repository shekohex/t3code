import { useAtomSet } from "@effect/atom-react";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileTerminalEnvironment = createTerminalEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileTerminalAttach(
  target: Parameters<typeof mobileTerminalEnvironment.attach>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileTerminalEnvironment.attach(target),
  );
}

export function useMobileTerminalEvents(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null ? null : mobileTerminalEnvironment.events({ environmentId, input: {} }),
  );
}

export function useMobileTerminalMetadata(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileTerminalEnvironment.metadata({ environmentId, input: null }),
  );
}

export function useMobileTerminalActions() {
  return {
    open: useAtomSet(mobileTerminalEnvironment.open, { mode: "promise" }),
    write: useAtomSet(mobileTerminalEnvironment.write, { mode: "promise" }),
    resize: useAtomSet(mobileTerminalEnvironment.resize, { mode: "promise" }),
    clear: useAtomSet(mobileTerminalEnvironment.clear, { mode: "promise" }),
    restart: useAtomSet(mobileTerminalEnvironment.restart, { mode: "promise" }),
    close: useAtomSet(mobileTerminalEnvironment.close, { mode: "promise" }),
  };
}

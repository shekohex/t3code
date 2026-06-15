import type { DiscoveredLocalServer, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { create } from "zustand";

import { previewEnvironment } from "./state/preview";
import { useEnvironmentQuery } from "./state/query";

const EMPTY_PORTS: ReadonlyArray<DiscoveredLocalServer> = Object.freeze([]);

interface PortDiscoveryState {
  readonly byEnvironment: Record<string, ReadonlyArray<DiscoveredLocalServer>>;
  setPorts: (environmentId: EnvironmentId, ports: ReadonlyArray<DiscoveredLocalServer>) => void;
  clearEnvironment: (environmentId: EnvironmentId) => void;
  reset: () => void;
}

export const usePortDiscoveryStore = create<PortDiscoveryState>((set) => ({
  byEnvironment: {},
  setPorts: (environmentId, ports) =>
    set((state) => ({
      byEnvironment: {
        ...state.byEnvironment,
        [environmentId]: ports,
      },
    })),
  clearEnvironment: (environmentId) =>
    set((state) => {
      if (!(environmentId in state.byEnvironment)) return state;
      const { [environmentId]: _removed, ...byEnvironment } = state.byEnvironment;
      return { byEnvironment };
    }),
  reset: () => set({ byEnvironment: {} }),
}));

export function useDiscoveredPorts(
  environmentId: EnvironmentId | null,
): ReadonlyArray<DiscoveredLocalServer> {
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : previewEnvironment.discoveredServers({ environmentId, input: {} }),
  );
  return query.data?.servers ?? EMPTY_PORTS;
}

export function useThreadDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.threadId
        ? ports.filter((port) => port.terminal?.threadId === input.threadId)
        : EMPTY_PORTS,
    [input.threadId, ports],
  );
}

export function useTerminalDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly terminalId: string | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.threadId && input.terminalId
        ? ports.filter(
            (port) =>
              port.terminal?.threadId === input.threadId &&
              port.terminal.terminalId === input.terminalId,
          )
        : EMPTY_PORTS,
    [input.terminalId, input.threadId, ports],
  );
}

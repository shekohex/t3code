import { useAtomSet } from "@effect/atom-react";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime);

export function useServerConfig(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.config({ environmentId, input: {} }),
  );
}

export function useServerSettings(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.settings({ environmentId, input: {} }),
  );
}

export function useTraceDiagnostics(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
}

export function useProcessDiagnostics(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
}

export function useProcessResourceHistory(
  target: Parameters<typeof serverEnvironment.processResourceHistory>[0] | null,
) {
  return useEnvironmentQuery(
    target === null ? null : serverEnvironment.processResourceHistory(target),
  );
}

export function useServerConfigChanges(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.configChanges({ environmentId, input: {} }),
  );
}

export function useServerLifecycleChanges(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.lifecycleChanges({ environmentId, input: {} }),
  );
}

export function useServerActions() {
  return {
    refreshProviders: useAtomSet(serverEnvironment.refreshProviders, {
      mode: "promise",
    }),
    updateProvider: useAtomSet(serverEnvironment.updateProvider, { mode: "promise" }),
    upsertKeybinding: useAtomSet(serverEnvironment.upsertKeybinding, {
      mode: "promise",
    }),
    removeKeybinding: useAtomSet(serverEnvironment.removeKeybinding, {
      mode: "promise",
    }),
    updateSettings: useAtomSet(serverEnvironment.updateSettings, { mode: "promise" }),
    signalProcess: useAtomSet(serverEnvironment.signalProcess, { mode: "promise" }),
  };
}

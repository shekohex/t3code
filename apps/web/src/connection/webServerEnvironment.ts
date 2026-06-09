import { useAtomSet } from "@effect/atom-react";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webServerEnvironment = createServerEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebServerConfig(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null ? null : webServerEnvironment.config({ environmentId, input: {} }),
  );
}

export function useWebServerSettings(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null ? null : webServerEnvironment.settings({ environmentId, input: {} }),
  );
}

export function useWebTraceDiagnostics(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webServerEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
}

export function useWebProcessDiagnostics(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webServerEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
}

export function useWebProcessResourceHistory(
  target: Parameters<typeof webServerEnvironment.processResourceHistory>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webServerEnvironment.processResourceHistory(target),
  );
}

export function useWebServerConfigChanges(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webServerEnvironment.configChanges({ environmentId, input: {} }),
  );
}

export function useWebServerLifecycleChanges(environmentId: EnvironmentId | null) {
  return useWebEnvironmentQuery(
    environmentId === null
      ? null
      : webServerEnvironment.lifecycleChanges({ environmentId, input: {} }),
  );
}

export function useWebServerActions() {
  return {
    refreshProviders: useAtomSet(webServerEnvironment.refreshProviders, {
      mode: "promise",
    }),
    updateProvider: useAtomSet(webServerEnvironment.updateProvider, { mode: "promise" }),
    upsertKeybinding: useAtomSet(webServerEnvironment.upsertKeybinding, {
      mode: "promise",
    }),
    removeKeybinding: useAtomSet(webServerEnvironment.removeKeybinding, {
      mode: "promise",
    }),
    updateSettings: useAtomSet(webServerEnvironment.updateSettings, { mode: "promise" }),
    signalProcess: useAtomSet(webServerEnvironment.signalProcess, { mode: "promise" }),
  };
}

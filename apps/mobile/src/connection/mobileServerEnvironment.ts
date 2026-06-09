import { useAtomSet } from "@effect/atom-react";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileServerEnvironment = createServerEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileServerConfig(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null ? null : mobileServerEnvironment.config({ environmentId, input: {} }),
  );
}

export function useMobileServerSettings(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null ? null : mobileServerEnvironment.settings({ environmentId, input: {} }),
  );
}

export function useMobileTraceDiagnostics(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileServerEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
}

export function useMobileProcessDiagnostics(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileServerEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
}

export function useMobileProcessResourceHistory(
  target: Parameters<typeof mobileServerEnvironment.processResourceHistory>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileServerEnvironment.processResourceHistory(target),
  );
}

export function useMobileServerConfigChanges(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileServerEnvironment.configChanges({ environmentId, input: {} }),
  );
}

export function useMobileServerLifecycleChanges(environmentId: EnvironmentId | null) {
  return useMobileEnvironmentQuery(
    environmentId === null
      ? null
      : mobileServerEnvironment.lifecycleChanges({ environmentId, input: {} }),
  );
}

export function useMobileServerActions() {
  return {
    refreshProviders: useAtomSet(mobileServerEnvironment.refreshProviders, {
      mode: "promise",
    }),
    updateProvider: useAtomSet(mobileServerEnvironment.updateProvider, { mode: "promise" }),
    upsertKeybinding: useAtomSet(mobileServerEnvironment.upsertKeybinding, {
      mode: "promise",
    }),
    removeKeybinding: useAtomSet(mobileServerEnvironment.removeKeybinding, {
      mode: "promise",
    }),
    updateSettings: useAtomSet(mobileServerEnvironment.updateSettings, { mode: "promise" }),
    signalProcess: useAtomSet(mobileServerEnvironment.signalProcess, { mode: "promise" }),
  };
}

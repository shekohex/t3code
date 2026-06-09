import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcMutation,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createServerEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    config: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:config",
      tag: WS_METHODS.serverGetConfig,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:settings",
      tag: WS_METHODS.serverGetSettings,
    }),
    traceDiagnostics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:trace-diagnostics",
      tag: WS_METHODS.serverGetTraceDiagnostics,
    }),
    processDiagnostics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:process-diagnostics",
      tag: WS_METHODS.serverGetProcessDiagnostics,
    }),
    processResourceHistory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:process-resource-history",
      tag: WS_METHODS.serverGetProcessResourceHistory,
    }),
    configChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:config-changes",
      tag: WS_METHODS.subscribeServerConfig,
    }),
    lifecycleChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:lifecycle-changes",
      tag: WS_METHODS.subscribeServerLifecycle,
    }),
    refreshProviders: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:refresh-providers",
      tag: WS_METHODS.serverRefreshProviders,
    }),
    updateProvider: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:update-provider",
      tag: WS_METHODS.serverUpdateProvider,
    }),
    upsertKeybinding: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:upsert-keybinding",
      tag: WS_METHODS.serverUpsertKeybinding,
    }),
    removeKeybinding: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:remove-keybinding",
      tag: WS_METHODS.serverRemoveKeybinding,
    }),
    updateSettings: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:update-settings",
      tag: WS_METHODS.serverUpdateSettings,
    }),
    signalProcess: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:server:signal-process",
      tag: WS_METHODS.serverSignalProcess,
    }),
  };
}

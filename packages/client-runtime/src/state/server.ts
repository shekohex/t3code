import {
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleWelcomePayload,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcMutation,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function applyServerConfigProjection(
  current: Option.Option<ServerConfig>,
  event: ServerConfigStreamEvent,
): Option.Option<ServerConfig> {
  switch (event.type) {
    case "snapshot":
      return Option.some(event.config);
    case "keybindingsUpdated":
      return Option.map(current, (config) => ({
        ...config,
        keybindings: event.payload.keybindings,
        issues: event.payload.issues,
      }));
    case "providerStatuses":
      return Option.map(current, (config) => ({
        ...config,
        providers: event.payload.providers,
      }));
    case "settingsUpdated":
      return Option.map(current, (config) => ({
        ...config,
        settings: event.payload.settings,
      }));
  }
}

export function projectServerConfig(
  current: Option.Option<ServerConfig>,
  event: ServerConfigStreamEvent,
): readonly [Option.Option<ServerConfig>, ReadonlyArray<ServerConfig>] {
  const next = applyServerConfigProjection(current, event);
  return [next, Option.toArray(next)];
}

export function projectServerWelcome(
  current: Option.Option<ServerLifecycleWelcomePayload>,
  event: {
    readonly type: "welcome" | "ready";
    readonly payload: unknown;
  },
): readonly [
  Option.Option<ServerLifecycleWelcomePayload>,
  ReadonlyArray<ServerLifecycleWelcomePayload>,
] {
  if (event.type !== "welcome") {
    return [current, []];
  }
  const welcome = event.payload as ServerLifecycleWelcomePayload;
  return [Option.some(welcome), [welcome]];
}

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
    configProjection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:config-projection",
      tag: WS_METHODS.subscribeServerConfig,
      transform: (stream) =>
        stream.pipe(Stream.mapAccum(Option.none<ServerConfig>, projectServerConfig)),
    }),
    welcome: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:welcome",
      tag: WS_METHODS.subscribeServerLifecycle,
      transform: (stream) =>
        stream.pipe(
          Stream.mapAccum(Option.none<ServerLifecycleWelcomePayload>, projectServerWelcome),
        ),
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

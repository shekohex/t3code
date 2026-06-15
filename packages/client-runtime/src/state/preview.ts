import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcMutation,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createPreviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:preview:list",
      tag: WS_METHODS.previewList,
      staleTimeMs: 5_000,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview:events",
      tag: WS_METHODS.subscribePreviewEvents,
    }),
    discoveredServers: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview:discovered-servers",
      tag: WS_METHODS.subscribeDiscoveredLocalServers,
    }),
    automationRequests: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview:automation-requests",
      tag: WS_METHODS.previewAutomationConnect,
    }),
    open: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:open",
      tag: WS_METHODS.previewOpen,
    }),
    navigate: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:navigate",
      tag: WS_METHODS.previewNavigate,
    }),
    refresh: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:refresh",
      tag: WS_METHODS.previewRefresh,
    }),
    close: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:close",
      tag: WS_METHODS.previewClose,
    }),
    reportStatus: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:report-status",
      tag: WS_METHODS.previewReportStatus,
    }),
    respondToAutomation: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:automation-respond",
      tag: WS_METHODS.previewAutomationRespond,
    }),
    reportAutomationOwner: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:automation-report-owner",
      tag: WS_METHODS.previewAutomationReportOwner,
    }),
    clearAutomationOwner: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:preview:automation-clear-owner",
      tag: WS_METHODS.previewAutomationClearOwner,
    }),
  };
}

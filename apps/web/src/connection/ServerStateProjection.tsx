import type { ServerConfigStreamEvent, ServerLifecycleStreamEvent } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { applyServerConfigEvent, emitWelcome, setServerConfigSnapshot } from "../rpc/serverState";
import {
  useServerConfig,
  useServerConfigChanges,
  useServerLifecycleChanges,
} from "./useEnvironmentData";
import { usePrimaryEnvironment } from "./useEnvironments";

function serverConfigEventKey(event: ServerConfigStreamEvent): string {
  switch (event.type) {
    case "snapshot":
      return `snapshot:${JSON.stringify(event.config)}`;
    case "keybindingsUpdated":
    case "providerStatuses":
    case "settingsUpdated":
      return `${event.type}:${JSON.stringify(event.payload)}`;
  }
}

function serverLifecycleEventKey(event: ServerLifecycleStreamEvent): string {
  return `${event.type}:${event.sequence}`;
}

export function ServerStateProjection() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const config = useServerConfig(environmentId);
  const configChanges = useServerConfigChanges(environmentId);
  const lifecycleChanges = useServerLifecycleChanges(environmentId);
  const projectedConfigRef = useRef<unknown>(null);
  const projectedConfigEventRef = useRef<string | null>(null);
  const projectedLifecycleEventRef = useRef<string | null>(null);

  useEffect(() => {
    if (config.data === null || projectedConfigRef.current === config.data) {
      return;
    }
    projectedConfigRef.current = config.data;
    setServerConfigSnapshot(config.data);
  }, [config.data]);

  useEffect(() => {
    if (configChanges.data === null) {
      return;
    }
    const key = serverConfigEventKey(configChanges.data);
    if (projectedConfigEventRef.current === key) {
      return;
    }
    projectedConfigEventRef.current = key;
    applyServerConfigEvent(configChanges.data);
  }, [configChanges.data]);

  useEffect(() => {
    if (lifecycleChanges.data === null) {
      return;
    }
    const key = serverLifecycleEventKey(lifecycleChanges.data);
    if (projectedLifecycleEventRef.current === key) {
      return;
    }
    projectedLifecycleEventRef.current = key;
    if (lifecycleChanges.data.type === "welcome") {
      emitWelcome(lifecycleChanges.data.payload);
    }
  }, [lifecycleChanges.data]);

  return null;
}

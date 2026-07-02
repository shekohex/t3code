import type { PiAgentSettings } from "@t3tools/contracts";

import { expandHomePath } from "../pathExpansion.ts";

export function splitPiLaunchArgs(value: string): ReadonlyArray<string> {
  return value.trim().length === 0 ? [] : value.trim().split(/\s+/g);
}

export function buildPiEnvironment(
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...(settings.agentDir ? { PI_CODING_AGENT_DIR: expandHomePath(settings.agentDir) } : {}),
  };
}

import { makeRelayClientTracingLayer } from "@t3tools/shared/relayTracing";

import { resolveRelayClientTracingConfig } from "./publicConfig.ts";

export const serverRelayClientTracingLayer = makeRelayClientTracingLayer(
  resolveRelayClientTracingConfig(),
  {
    serviceName: "t3-headless-relay-client",
    runtime: "node",
    client: "headless-cli",
  },
);

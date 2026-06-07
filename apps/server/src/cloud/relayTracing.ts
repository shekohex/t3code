import { makeRelayClientTracingLayer } from "@t3tools/client-runtime";

import { resolveRelayClientTracingConfig } from "./publicConfig.ts";

export const serverRelayClientTracingLayer = makeRelayClientTracingLayer(
  resolveRelayClientTracingConfig(),
  {
    serviceName: "t3-headless-relay-client",
    runtime: "node",
    client: "headless-cli",
  },
);

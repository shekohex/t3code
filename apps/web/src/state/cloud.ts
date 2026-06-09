import { createCloudEnvironmentAtoms } from "@t3tools/client-runtime/state/cloud";

import { connectionAtomRuntime } from "../connection/runtime";

export const cloudEnvironment = createCloudEnvironmentAtoms(connectionAtomRuntime);

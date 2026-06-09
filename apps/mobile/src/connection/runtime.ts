import { connectionLayer as clientConnectionLayer } from "@t3tools/client-runtime/connection";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeLayer } from "../lib/runtime";
import { connectionPlatformLayer } from "./platform";

const connectionDependencies = Layer.mergeAll(runtimeLayer, connectionPlatformLayer);

export const connectionLayer = clientConnectionLayer.pipe(
  Layer.provideMerge(connectionDependencies),
);

export const connectionAtomRuntime = Atom.runtime(connectionLayer);

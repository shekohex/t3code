import { connectionLayer as clientConnectionLayer } from "@t3tools/client-runtime/connection";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeLayer } from "../lib/runtime";
import { connectionPlatformLayer } from "./platform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(Layer.provide(runtimeLayer));

export const connectionLayer = clientConnectionLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(runtimeLayer, providedConnectionPlatformLayer)),
);

export const connectionAtomRuntime = Atom.runtime(connectionLayer);

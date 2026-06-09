import {
  connectionApplicationLayer,
  ConnectionOnboarding,
  createEnvironmentConnectionAtoms,
  createRelayEnvironmentDiscoveryAtoms,
} from "@t3tools/client-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { mobileRuntimeLayer } from "../lib/runtime";
import { mobileConnectionPlatformLayer } from "./mobileConnectionPlatform";

const mobileConnectionDependencies = Layer.mergeAll(
  mobileRuntimeLayer,
  mobileConnectionPlatformLayer,
);

export const mobileConnectionLayer = connectionApplicationLayer.pipe(
  Layer.provide(mobileConnectionDependencies),
);

export const mobileConnectionAtomRuntime = Atom.runtime(mobileConnectionLayer);

export const mobileEnvironmentConnections = createEnvironmentConnectionAtoms(
  mobileConnectionAtomRuntime,
);

export const mobileRelayEnvironmentDiscovery = createRelayEnvironmentDiscoveryAtoms(
  mobileConnectionAtomRuntime,
);

export const connectMobilePairingUrl = mobileConnectionAtomRuntime
  .fn<string>()((pairingUrl) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
    ),
  )
  .pipe(Atom.withLabel("mobile:connection:connect-pairing-url"));

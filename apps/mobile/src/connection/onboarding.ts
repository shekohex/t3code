import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "./runtime";

export const connectPairingUrl = connectionAtomRuntime
  .fn<string>()((pairingUrl) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
    ),
  )
  .pipe(Atom.withLabel("mobile:connection:connect-pairing-url"));

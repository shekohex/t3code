import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
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

export const updateBearerConnection = connectionAtomRuntime
  .fn<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }>()((input) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.updateBearer(input))),
  )
  .pipe(Atom.withLabel("mobile:connection:update-bearer"));

import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "./runtime";

export const connectPairing = connectionAtomRuntime
  .fn<{
    readonly pairingUrl?: string;
    readonly host?: string;
    readonly pairingCode?: string;
  }>()((input) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerPairing(input))),
  )
  .pipe(Atom.withLabel("web:connection:connect-pairing"));

export const connectSshEnvironment = connectionAtomRuntime
  .fn<{
    readonly target: DesktopSshEnvironmentTarget;
    readonly label?: string;
  }>()((input) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerSsh(input))),
  )
  .pipe(Atom.withLabel("web:connection:connect-ssh"));

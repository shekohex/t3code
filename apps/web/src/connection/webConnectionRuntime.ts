import {
  connectionApplicationLayer,
  ConnectionOnboarding,
  createEnvironmentConnectionAtoms,
  createRelayEnvironmentDiscoveryAtoms,
} from "@t3tools/client-runtime";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import {
  linkPrimaryEnvironmentToCloud,
  type CloudLinkTarget,
  unlinkPrimaryEnvironmentFromCloud,
} from "../cloud/linkEnvironment";
import { webRuntimeLayer } from "../lib/runtime";
import { webConnectionPlatformLayer } from "./webConnectionPlatform";

const providedWebConnectionPlatformLayer = webConnectionPlatformLayer.pipe(
  Layer.provide(webRuntimeLayer),
);

export const webConnectionLayer = connectionApplicationLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(webRuntimeLayer, providedWebConnectionPlatformLayer)),
);

export const webConnectionAtomRuntime = Atom.runtime(webConnectionLayer);

export const webEnvironmentConnections = createEnvironmentConnectionAtoms(webConnectionAtomRuntime);

export const webRelayEnvironmentDiscovery =
  createRelayEnvironmentDiscoveryAtoms(webConnectionAtomRuntime);

export const connectWebPairing = webConnectionAtomRuntime
  .fn<{
    readonly pairingUrl?: string;
    readonly host?: string;
    readonly pairingCode?: string;
  }>()((input) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerPairing(input))),
  )
  .pipe(Atom.withLabel("web:connection:connect-pairing"));

export const connectWebSshEnvironment = webConnectionAtomRuntime
  .fn<{
    readonly target: DesktopSshEnvironmentTarget;
    readonly label?: string;
  }>()((input) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerSsh(input))),
  )
  .pipe(Atom.withLabel("web:connection:connect-ssh"));

export const linkWebPrimaryEnvironment = webConnectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string;
  }>()(linkPrimaryEnvironmentToCloud)
  .pipe(Atom.withLabel("web:connection:link-primary-cloud"));

export const unlinkWebPrimaryEnvironment = webConnectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string | null;
  }>()(unlinkPrimaryEnvironmentFromCloud)
  .pipe(Atom.withLabel("web:connection:unlink-primary-cloud"));

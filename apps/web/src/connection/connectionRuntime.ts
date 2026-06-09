import {
  connectionLayer as clientConnectionLayer,
  ConnectionOnboarding,
} from "@t3tools/client-runtime/connection";
import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import { createEnvironmentPresentationAtoms } from "@t3tools/client-runtime/state/presentation";
import { createEnvironmentProjectAtoms } from "@t3tools/client-runtime/state/projects";
import { createRelayEnvironmentDiscoveryAtoms } from "@t3tools/client-runtime/state/relay";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import {
  createEnvironmentServerConfigsAtom,
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
} from "@t3tools/client-runtime/state/shell";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
} from "@t3tools/client-runtime/state/threads";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import {
  linkPrimaryEnvironmentToCloud,
  type CloudLinkTarget,
  unlinkPrimaryEnvironmentFromCloud,
} from "../cloud/linkEnvironment";
import { runtimeLayer } from "../lib/runtime";
import { connectionPlatformLayer } from "./connectionPlatform";

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(Layer.provide(runtimeLayer));

export const connectionLayer = clientConnectionLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(runtimeLayer, providedConnectionPlatformLayer)),
);

export const connectionAtomRuntime = Atom.runtime(connectionLayer);

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);
export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  configValueAtom: environmentSession.configValueAtom,
});
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  configValueAtom: environmentSession.configValueAtom,
});

export const relayEnvironmentDiscovery =
  createRelayEnvironmentDiscoveryAtoms(connectionAtomRuntime);

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

export const linkPrimaryEnvironment = connectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string;
  }>()(linkPrimaryEnvironmentToCloud)
  .pipe(Atom.withLabel("web:connection:link-primary-cloud"));

export const unlinkPrimaryEnvironment = connectionAtomRuntime
  .fn<{
    readonly target: CloudLinkTarget;
    readonly clerkToken: string | null;
  }>()(unlinkPrimaryEnvironmentFromCloud)
  .pipe(Atom.withLabel("web:connection:unlink-primary-cloud"));

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
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import { runtimeLayer } from "../lib/runtime";
import { connectionPlatformLayer } from "./connectionPlatform";

const connectionDependencies = Layer.mergeAll(runtimeLayer, connectionPlatformLayer);

export const connectionLayer = clientConnectionLayer.pipe(
  Layer.provideMerge(connectionDependencies),
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

export const connectPairingUrl = connectionAtomRuntime
  .fn<string>()((pairingUrl) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
    ),
  )
  .pipe(Atom.withLabel("mobile:connection:connect-pairing-url"));

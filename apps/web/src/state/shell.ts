import { useAtomSet } from "@effect/atom-react";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export function useEnvironmentShell(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : environmentShell.stateAtom(environmentId),
  );
}

export function useShellActions() {
  return {
    openInEditor: useAtomSet(shellEnvironment.openInEditor, { mode: "promise" }),
  };
}

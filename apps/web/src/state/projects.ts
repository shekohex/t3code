import { useAtomSet } from "@effect/atom-react";
import { createEnvironmentProjectAtoms } from "@t3tools/client-runtime/state/projects";
import { createProjectEnvironmentAtoms } from "@t3tools/client-runtime/state/projects";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { environmentSnapshotAtom } from "./shell";

export const projectEnvironment = createProjectEnvironmentAtoms(connectionAtomRuntime);
export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

export function useProjectSearchEntries(
  target: Parameters<typeof projectEnvironment.searchEntries>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : projectEnvironment.searchEntries(target));
}

export function useProjectActions() {
  return {
    create: useAtomSet(projectEnvironment.create, { mode: "promise" }),
    update: useAtomSet(projectEnvironment.update, { mode: "promise" }),
    delete: useAtomSet(projectEnvironment.delete, { mode: "promise" }),
    writeFile: useAtomSet(projectEnvironment.writeFile, { mode: "promise" }),
  };
}

import { useAtomSet } from "@effect/atom-react";
import { createProjectEnvironmentAtoms } from "@t3tools/client-runtime/state/projects";

import { connectionAtomRuntime } from "./connectionRuntime";
import { useEnvironmentQuery } from "./environmentQuery";

export const projectEnvironment = createProjectEnvironmentAtoms(connectionAtomRuntime);

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

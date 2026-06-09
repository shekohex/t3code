import { useAtomSet } from "@effect/atom-react";
import { createProjectEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

export const webProjectEnvironment = createProjectEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebProjectSearchEntries(
  target: Parameters<typeof webProjectEnvironment.searchEntries>[0] | null,
) {
  return useWebEnvironmentQuery(
    target === null ? null : webProjectEnvironment.searchEntries(target),
  );
}

export function useWebProjectActions() {
  return {
    create: useAtomSet(webProjectEnvironment.create, { mode: "promise" }),
    update: useAtomSet(webProjectEnvironment.update, { mode: "promise" }),
    delete: useAtomSet(webProjectEnvironment.delete, { mode: "promise" }),
    writeFile: useAtomSet(webProjectEnvironment.writeFile, { mode: "promise" }),
  };
}

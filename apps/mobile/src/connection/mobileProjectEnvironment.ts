import { useAtomSet } from "@effect/atom-react";
import { createProjectEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

export const mobileProjectEnvironment = createProjectEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileProjectSearchEntries(
  target: Parameters<typeof mobileProjectEnvironment.searchEntries>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileProjectEnvironment.searchEntries(target),
  );
}

export function useMobileProjectActions() {
  return {
    create: useAtomSet(mobileProjectEnvironment.create, { mode: "promise" }),
    update: useAtomSet(mobileProjectEnvironment.update, { mode: "promise" }),
    delete: useAtomSet(mobileProjectEnvironment.delete, { mode: "promise" }),
    writeFile: useAtomSet(mobileProjectEnvironment.writeFile, { mode: "promise" }),
  };
}

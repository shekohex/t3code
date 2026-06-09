import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";
import { useMobileEnvironmentQuery } from "./mobileEnvironmentQuery";

const mobileFilesystemEnvironment = createFilesystemEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileFilesystemBrowse(
  target: Parameters<typeof mobileFilesystemEnvironment.browse>[0] | null,
) {
  return useMobileEnvironmentQuery(
    target === null ? null : mobileFilesystemEnvironment.browse(target),
  );
}

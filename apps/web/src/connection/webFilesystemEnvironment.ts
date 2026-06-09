import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";
import { useWebEnvironmentQuery } from "./webEnvironmentQuery";

const webFilesystemEnvironment = createFilesystemEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebFilesystemBrowse(
  target: Parameters<typeof webFilesystemEnvironment.browse>[0] | null,
) {
  return useWebEnvironmentQuery(target === null ? null : webFilesystemEnvironment.browse(target));
}

import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime/state/filesystem";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const filesystemEnvironment = createFilesystemEnvironmentAtoms(connectionAtomRuntime);

export function useFilesystemBrowse(
  target: Parameters<typeof filesystemEnvironment.browse>[0] | null,
) {
  return useEnvironmentQuery(target === null ? null : filesystemEnvironment.browse(target));
}

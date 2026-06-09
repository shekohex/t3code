import type { EnvironmentId, FilesystemBrowseInput } from "@t3tools/contracts";

import { useFilesystemDirectory } from "../state/queries";

export function useFilesystemBrowse(
  environmentId: EnvironmentId | null,
  input: FilesystemBrowseInput | null,
) {
  return useFilesystemDirectory(environmentId, input);
}

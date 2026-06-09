import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentMutation,
  createEnvironmentRpcMutation,
  createEnvironmentRpcQueryAtomFamily,
} from "../atoms.ts";
import {
  EnvironmentProjectCommands,
  type CreateProjectInput,
  type DeleteProjectInput,
  type UpdateProjectInput,
} from "../commands.ts";
import type { EnvironmentRegistry } from "../registry.ts";

export function createProjectEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    searchEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:search-entries",
      tag: WS_METHODS.projectsSearchEntries,
      staleTimeMs: 15_000,
    }),
    create: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:project:create",
      execute: (input: CreateProjectInput) =>
        EnvironmentProjectCommands.pipe(Effect.flatMap((commands) => commands.create(input))),
    }),
    update: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:project:update",
      execute: (input: UpdateProjectInput) =>
        EnvironmentProjectCommands.pipe(Effect.flatMap((commands) => commands.update(input))),
    }),
    delete: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:project:delete",
      execute: (input: DeleteProjectInput) =>
        EnvironmentProjectCommands.pipe(Effect.flatMap((commands) => commands.delete(input))),
    }),
    writeFile: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:projects:write-file",
      tag: WS_METHODS.projectsWriteFile,
    }),
  };
}

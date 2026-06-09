import { Atom } from "effect/unstable/reactivity";
import * as Effect from "effect/Effect";

import { createEnvironmentMutation } from "../atoms.ts";
import {
  EnvironmentThreadCommands,
  type ArchiveThreadInput,
  type CreateThreadInput,
  type DeleteThreadInput,
  type InterruptThreadTurnInput,
  type RespondToThreadApprovalInput,
  type RespondToThreadUserInputInput,
  type RevertThreadCheckpointInput,
  type SetThreadInteractionModeInput,
  type SetThreadRuntimeModeInput,
  type StartThreadTurnInput,
  type StopThreadSessionInput,
  type UnarchiveThreadInput,
  type UpdateThreadMetadataInput,
} from "../commands.ts";
import type { EnvironmentRegistry } from "../registry.ts";

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    create: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:create",
      execute: (input: CreateThreadInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.create(input))),
    }),
    delete: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:delete",
      execute: (input: DeleteThreadInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.delete(input))),
    }),
    archive: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:archive",
      execute: (input: ArchiveThreadInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.archive(input))),
    }),
    unarchive: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:unarchive",
      execute: (input: UnarchiveThreadInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.unarchive(input))),
    }),
    updateMetadata: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:update-metadata",
      execute: (input: UpdateThreadMetadataInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.updateMetadata(input)),
        ),
    }),
    setRuntimeMode: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:set-runtime-mode",
      execute: (input: SetThreadRuntimeModeInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.setRuntimeMode(input)),
        ),
    }),
    setInteractionMode: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:set-interaction-mode",
      execute: (input: SetThreadInteractionModeInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.setInteractionMode(input)),
        ),
    }),
    startTurn: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:start-turn",
      execute: (input: StartThreadTurnInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.startTurn(input))),
    }),
    interruptTurn: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:interrupt-turn",
      execute: (input: InterruptThreadTurnInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.interruptTurn(input))),
    }),
    respondToApproval: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:respond-to-approval",
      execute: (input: RespondToThreadApprovalInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.respondToApproval(input)),
        ),
    }),
    respondToUserInput: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:respond-to-user-input",
      execute: (input: RespondToThreadUserInputInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.respondToUserInput(input)),
        ),
    }),
    revertCheckpoint: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:revert-checkpoint",
      execute: (input: RevertThreadCheckpointInput) =>
        EnvironmentThreadCommands.pipe(
          Effect.flatMap((commands) => commands.revertCheckpoint(input)),
        ),
    }),
    stopSession: createEnvironmentMutation(runtime, {
      label: "environment-data:commands:thread:stop-session",
      execute: (input: StopThreadSessionInput) =>
        EnvironmentThreadCommands.pipe(Effect.flatMap((commands) => commands.stopSession(input))),
    }),
  };
}

import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type {
  EnvironmentRpcFailure,
  EnvironmentRpcService,
  EnvironmentRpcSuccess,
  EnvironmentRpcUnavailableError,
} from "./runtime.ts";

type CommandType = ClientOrchestrationCommand["type"];
type CommandOf<T extends CommandType> = Extract<ClientOrchestrationCommand, { readonly type: T }>;
type CommandInput<T extends CommandType> = Omit<
  CommandOf<T>,
  "type" | "commandId" | "createdAt"
> & {
  readonly commandId?: CommandId;
} & ("createdAt" extends keyof CommandOf<T>
    ? {
        readonly createdAt?: CommandOf<T>["createdAt"];
      }
    : {});

export type CreateProjectInput = CommandInput<"project.create">;
export type UpdateProjectInput = CommandInput<"project.meta.update">;
export type DeleteProjectInput = CommandInput<"project.delete">;
export type CreateThreadInput = CommandInput<"thread.create">;
export type DeleteThreadInput = CommandInput<"thread.delete">;
export type ArchiveThreadInput = CommandInput<"thread.archive">;
export type UnarchiveThreadInput = CommandInput<"thread.unarchive">;
export type UpdateThreadMetadataInput = CommandInput<"thread.meta.update">;
export type SetThreadRuntimeModeInput = CommandInput<"thread.runtime-mode.set">;
export type SetThreadInteractionModeInput = CommandInput<"thread.interaction-mode.set">;
export type StartThreadTurnInput = CommandInput<"thread.turn.start">;
export type InterruptThreadTurnInput = CommandInput<"thread.turn.interrupt">;
export type RespondToThreadApprovalInput = CommandInput<"thread.approval.respond">;
export type RespondToThreadUserInputInput = CommandInput<"thread.user-input.respond">;
export type RevertThreadCheckpointInput = CommandInput<"thread.checkpoint.revert">;
export type StopThreadSessionInput = CommandInput<"thread.session.stop">;

type DispatchTag = typeof ORCHESTRATION_WS_METHODS.dispatchCommand;
type DispatchResult = EnvironmentRpcSuccess<DispatchTag>;
type DispatchError = EnvironmentRpcFailure<DispatchTag> | EnvironmentRpcUnavailableError;

export interface EnvironmentProjectCommandsService {
  readonly create: (input: CreateProjectInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly update: (input: UpdateProjectInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly delete: (input: DeleteProjectInput) => Effect.Effect<DispatchResult, DispatchError>;
}

export class EnvironmentProjectCommands extends Context.Service<
  EnvironmentProjectCommands,
  EnvironmentProjectCommandsService
>()("@t3tools/client-runtime/connection/commands/EnvironmentProjectCommands") {}

export interface EnvironmentThreadCommandsService {
  readonly create: (input: CreateThreadInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly delete: (input: DeleteThreadInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly archive: (input: ArchiveThreadInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly unarchive: (input: UnarchiveThreadInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly updateMetadata: (
    input: UpdateThreadMetadataInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly setRuntimeMode: (
    input: SetThreadRuntimeModeInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly setInteractionMode: (
    input: SetThreadInteractionModeInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly startTurn: (input: StartThreadTurnInput) => Effect.Effect<DispatchResult, DispatchError>;
  readonly interruptTurn: (
    input: InterruptThreadTurnInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly respondToApproval: (
    input: RespondToThreadApprovalInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly respondToUserInput: (
    input: RespondToThreadUserInputInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly revertCheckpoint: (
    input: RevertThreadCheckpointInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
  readonly stopSession: (
    input: StopThreadSessionInput,
  ) => Effect.Effect<DispatchResult, DispatchError>;
}

export class EnvironmentThreadCommands extends Context.Service<
  EnvironmentThreadCommands,
  EnvironmentThreadCommandsService
>()("@t3tools/client-runtime/connection/commands/EnvironmentThreadCommands") {}

function commandId(
  crypto: Crypto.Crypto,
  input: {
    readonly commandId?: CommandId;
  },
) {
  return input.commandId === undefined
    ? crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make))
    : Effect.succeed(input.commandId);
}

function timestampedCommandMetadata(
  crypto: Crypto.Crypto,
  input: {
    readonly commandId?: CommandId;
    readonly createdAt?: string;
  },
) {
  return Effect.all({
    commandId: commandId(crypto, input),
    createdAt:
      input.createdAt === undefined
        ? DateTime.now.pipe(Effect.map(DateTime.formatIso))
        : Effect.succeed(input.createdAt),
  });
}

export const makeEnvironmentProjectCommands = Effect.fn("EnvironmentProjectCommands.make")(
  function* (rpc: EnvironmentRpcService) {
    const crypto = yield* Crypto.Crypto;
    const dispatch = (command: ClientOrchestrationCommand) =>
      rpc.request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);

    const create = Effect.fn("EnvironmentProjectCommands.create")(function* (
      input: CreateProjectInput,
    ) {
      const metadata = yield* timestampedCommandMetadata(crypto, input);
      return yield* dispatch({
        ...input,
        type: "project.create",
        commandId: metadata.commandId,
        createdAt: metadata.createdAt,
      });
    });
    const update = Effect.fn("EnvironmentProjectCommands.update")(function* (
      input: UpdateProjectInput,
    ) {
      const nextCommandId = yield* commandId(crypto, input);
      return yield* dispatch({
        ...input,
        type: "project.meta.update",
        commandId: nextCommandId,
      });
    });
    const deleteProject = Effect.fn("EnvironmentProjectCommands.delete")(function* (
      input: DeleteProjectInput,
    ) {
      const nextCommandId = yield* commandId(crypto, input);
      return yield* dispatch({
        ...input,
        type: "project.delete",
        commandId: nextCommandId,
      });
    });

    return EnvironmentProjectCommands.of({
      create,
      update,
      delete: deleteProject,
    });
  },
);

export const makeEnvironmentThreadCommands = Effect.fn("EnvironmentThreadCommands.make")(function* (
  rpc: EnvironmentRpcService,
) {
  const crypto = yield* Crypto.Crypto;
  const dispatch = (command: ClientOrchestrationCommand) =>
    rpc.request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);

  const createThread = Effect.fn("EnvironmentThreadCommands.create")(function* (
    input: CreateThreadInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.create",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });
  const deleteThread = Effect.fn("EnvironmentThreadCommands.delete")(function* (
    input: DeleteThreadInput,
  ) {
    const nextCommandId = yield* commandId(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.delete",
      commandId: nextCommandId,
    });
  });
  const archiveThread = Effect.fn("EnvironmentThreadCommands.archive")(function* (
    input: ArchiveThreadInput,
  ) {
    const nextCommandId = yield* commandId(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.archive",
      commandId: nextCommandId,
    });
  });
  const unarchiveThread = Effect.fn("EnvironmentThreadCommands.unarchive")(function* (
    input: UnarchiveThreadInput,
  ) {
    const nextCommandId = yield* commandId(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.unarchive",
      commandId: nextCommandId,
    });
  });
  const updateThreadMetadata = Effect.fn("EnvironmentThreadCommands.updateMetadata")(function* (
    input: UpdateThreadMetadataInput,
  ) {
    const nextCommandId = yield* commandId(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.meta.update",
      commandId: nextCommandId,
    });
  });
  const setThreadRuntimeMode = Effect.fn("EnvironmentThreadCommands.setRuntimeMode")(function* (
    input: SetThreadRuntimeModeInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.runtime-mode.set",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });
  const setThreadInteractionMode = Effect.fn("EnvironmentThreadCommands.setInteractionMode")(
    function* (input: SetThreadInteractionModeInput) {
      const metadata = yield* timestampedCommandMetadata(crypto, input);
      return yield* dispatch({
        ...input,
        type: "thread.interaction-mode.set",
        commandId: metadata.commandId,
        createdAt: metadata.createdAt,
      });
    },
  );
  const startThreadTurn = Effect.fn("EnvironmentThreadCommands.startTurn")(function* (
    input: StartThreadTurnInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.turn.start",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });
  const interruptThreadTurn = Effect.fn("EnvironmentThreadCommands.interruptTurn")(function* (
    input: InterruptThreadTurnInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.turn.interrupt",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });
  const respondToThreadApproval = Effect.fn("EnvironmentThreadCommands.respondToApproval")(
    function* (input: RespondToThreadApprovalInput) {
      const metadata = yield* timestampedCommandMetadata(crypto, input);
      return yield* dispatch({
        ...input,
        type: "thread.approval.respond",
        commandId: metadata.commandId,
        createdAt: metadata.createdAt,
      });
    },
  );
  const respondToThreadUserInput = Effect.fn("EnvironmentThreadCommands.respondToUserInput")(
    function* (input: RespondToThreadUserInputInput) {
      const metadata = yield* timestampedCommandMetadata(crypto, input);
      return yield* dispatch({
        ...input,
        type: "thread.user-input.respond",
        commandId: metadata.commandId,
        createdAt: metadata.createdAt,
      });
    },
  );
  const revertThreadCheckpoint = Effect.fn("EnvironmentThreadCommands.revertCheckpoint")(function* (
    input: RevertThreadCheckpointInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.checkpoint.revert",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });
  const stopThreadSession = Effect.fn("EnvironmentThreadCommands.stopSession")(function* (
    input: StopThreadSessionInput,
  ) {
    const metadata = yield* timestampedCommandMetadata(crypto, input);
    return yield* dispatch({
      ...input,
      type: "thread.session.stop",
      commandId: metadata.commandId,
      createdAt: metadata.createdAt,
    });
  });

  return EnvironmentThreadCommands.of({
    create: createThread,
    delete: deleteThread,
    archive: archiveThread,
    unarchive: unarchiveThread,
    updateMetadata: updateThreadMetadata,
    setRuntimeMode: setThreadRuntimeMode,
    setInteractionMode: setThreadInteractionMode,
    startTurn: startThreadTurn,
    interruptTurn: interruptThreadTurn,
    respondToApproval: respondToThreadApproval,
    respondToUserInput: respondToThreadUserInput,
    revertCheckpoint: revertThreadCheckpoint,
    stopSession: stopThreadSession,
  });
});

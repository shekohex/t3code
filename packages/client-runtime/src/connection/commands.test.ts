import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeEnvironmentProjectCommands, makeEnvironmentThreadCommands } from "./commands.ts";
import type { EnvironmentRpcService } from "./runtime.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

function makeRpc(dispatched: ClientOrchestrationCommand[]): EnvironmentRpcService {
  return {
    config: Effect.never,
    request: ((tag: string, input: unknown) => {
      if (tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) {
        return Effect.die(new Error(`Unexpected RPC method: ${tag}`));
      }
      return Effect.sync(() => {
        const command = input as ClientOrchestrationCommand;
        dispatched.push(command);
        return { sequence: dispatched.length };
      });
    }) as EnvironmentRpcService["request"],
    runStream: (() => {
      throw new Error("Unexpected stream RPC.");
    }) as EnvironmentRpcService["runStream"],
    subscribe: (() => {
      throw new Error("Unexpected subscription RPC.");
    }) as EnvironmentRpcService["subscribe"],
  };
}

describe("environment command services", () => {
  it.effect("adds generated command metadata inside the service", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const commands = yield* makeEnvironmentProjectCommands(makeRpc(dispatched));

      const result = yield* commands.create({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      });

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const commands = yield* makeEnvironmentThreadCommands(makeRpc(dispatched));

      yield* commands.stopSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      });

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const commands = yield* makeEnvironmentThreadCommands(makeRpc(dispatched));

      yield* commands.archive({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      });

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});

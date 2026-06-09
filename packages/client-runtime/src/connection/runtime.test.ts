import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type RelayClientInstallProgressEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { WsRpcProtocolClient } from "../wsRpcProtocol.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import { EnvironmentCacheStore } from "./persistence.ts";
import type { RpcSession } from "./rpcSession.ts";
import { makeEnvironmentRpc, makeEnvironmentShell } from "./runtime.ts";
import type { EnvironmentSupervisorService } from "./supervisor.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const INSTALL_CHECKING: RelayClientInstallProgressEvent = {
  type: "progress",
  stage: "checking",
};
const INSTALL_DOWNLOADING: RelayClientInstallProgressEvent = {
  type: "progress",
  stage: "downloading",
};
const LIVE_SHELL_SNAPSHOT: OrchestrationShellSnapshot = {
  snapshotSequence: 1,
  projects: [],
  threads: [],
  updatedAt: "2026-06-06T00:00:00.000Z",
};

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

const makeHarness = Effect.fn("TestEnvironmentRpc.makeHarness")(function* () {
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE);
  const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.none());
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none());
  const retryCount = yield* Ref.make(0);
  const supervisor: EnvironmentSupervisorService = {
    target: TARGET,
    state,
    session: activeSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Ref.update(retryCount, (count) => count + 1),
  };
  return {
    activeSession,
    retryCount,
    state,
    supervisor,
    rpc: yield* makeEnvironmentRpc(supervisor),
  };
});

describe("EnvironmentRpc", () => {
  it.effect("binds finite streaming commands to one active session", () =>
    Effect.gen(function* () {
      const firstEvents = yield* Queue.unbounded<RelayClientInstallProgressEvent>();
      const secondEvents = yield* Queue.unbounded<RelayClientInstallProgressEvent>();
      const firstClient = {
        [WS_METHODS.cloudInstallRelayClient]: () => Stream.fromQueue(firstEvents),
      } as unknown as WsRpcProtocolClient;
      const secondClient = {
        [WS_METHODS.cloudInstallRelayClient]: () => Stream.fromQueue(secondEvents),
      } as unknown as WsRpcProtocolClient;
      const { activeSession, rpc } = yield* makeHarness();

      yield* SubscriptionRef.set(activeSession, Option.some(session(firstClient)));
      const resultFiber = yield* rpc
        .runStream(WS_METHODS.cloudInstallRelayClient, {})
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;

      yield* Queue.offer(firstEvents, INSTALL_CHECKING);
      yield* SubscriptionRef.set(activeSession, Option.some(session(secondClient)));
      yield* Queue.offer(secondEvents, INSTALL_DOWNLOADING);
      yield* Queue.offer(firstEvents, INSTALL_DOWNLOADING);

      const result = yield* Fiber.join(resultFiber);
      expect(result).toEqual([INSTALL_CHECKING, INSTALL_DOWNLOADING]);
    }),
  );

  it.effect("switches durable subscriptions when the supervisor replaces the session", () =>
    Effect.gen(function* () {
      const subscriptions: string[] = [];
      const firstClient = {
        [WS_METHODS.subscribeTerminalEvents]: () => {
          subscriptions.push("first");
          return Stream.never;
        },
      } as unknown as WsRpcProtocolClient;
      const secondClient = {
        [WS_METHODS.subscribeTerminalEvents]: () => {
          subscriptions.push("second");
          return Stream.never;
        },
      } as unknown as WsRpcProtocolClient;
      const { activeSession, retryCount, rpc } = yield* makeHarness();
      const awaitSubscriptions = Effect.fn("TestEnvironmentRpc.awaitSubscriptions")(function* (
        count: number,
      ) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (subscriptions.length >= count) {
            return;
          }
          yield* Effect.yieldNow;
        }
        return yield* Effect.die(new Error(`Expected ${count} durable subscriptions.`));
      });

      const subscriptionFiber = yield* rpc
        .subscribe(WS_METHODS.subscribeTerminalEvents, {})
        .pipe(Stream.runDrain, Effect.forkChild);
      yield* SubscriptionRef.set(activeSession, Option.some(session(firstClient)));
      yield* awaitSubscriptions(1);
      yield* SubscriptionRef.set(activeSession, Option.some(session(secondClient)));
      yield* awaitSubscriptions(2);
      yield* Fiber.interrupt(subscriptionFiber);

      expect(subscriptions).toEqual(["first", "second"]);
      expect(yield* Ref.get(retryCount)).toBe(0);
    }),
  );

  it.effect("surfaces domain subscription failures without reconnecting", () =>
    Effect.gen(function* () {
      const domainError = new Error("terminal subscription rejected");
      const client = {
        [WS_METHODS.subscribeTerminalEvents]: () => Stream.fail(domainError),
      } as unknown as WsRpcProtocolClient;
      const { activeSession, retryCount, rpc } = yield* makeHarness();

      yield* SubscriptionRef.set(activeSession, Option.some(session(client)));
      const error = yield* rpc
        .subscribe(WS_METHODS.subscribeTerminalEvents, {})
        .pipe(Stream.runDrain, Effect.flip);

      expect(error).toBe(domainError);
      expect(yield* Ref.get(retryCount)).toBe(0);
    }),
  );
});

describe("EnvironmentShell", () => {
  it.effect("does not overwrite a live snapshot when the supervisor becomes ready", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationShellStreamItem>();
      const client = {
        [ORCHESTRATION_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      const { activeSession, state, supervisor, rpc } = yield* makeHarness();
      const cache = EnvironmentCacheStore.of({
        loadShell: () => Effect.succeed(Option.none()),
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeed(Option.none()),
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        clear: () => Effect.void,
      });
      const shell = yield* makeEnvironmentShell(supervisor, rpc, cache);

      yield* SubscriptionRef.set(state, {
        desired: true,
        network: "online",
        phase: "connecting",
        stage: "synchronizing",
        attempt: 1,
        generation: 0,
        lastFailure: null,
        retryAt: null,
      });
      yield* SubscriptionRef.set(activeSession, Option.some(session(client)));
      yield* Queue.offer(events, {
        kind: "snapshot",
        snapshot: LIVE_SHELL_SNAPSHOT,
      });
      yield* SubscriptionRef.changes(shell.state).pipe(
        Stream.filter((shellState) => shellState.status === "live"),
        Stream.runHead,
      );

      yield* SubscriptionRef.set(state, {
        desired: true,
        network: "online",
        phase: "connected",
        stage: null,
        attempt: 1,
        generation: 1,
        lastFailure: null,
        retryAt: null,
      });
      for (let index = 0; index < 10; index += 1) {
        yield* Effect.yieldNow;
      }

      const shellState = yield* SubscriptionRef.get(shell.state);
      expect(shellState.status).toBe("live");
      expect(Option.getOrThrow(shellState.snapshot)).toEqual(LIVE_SHELL_SNAPSHOT);
    }),
  );
});

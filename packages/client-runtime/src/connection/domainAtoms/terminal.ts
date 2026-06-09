import { type TerminalSummary, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcMutation,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "../atoms.ts";
import type { EnvironmentRegistry } from "../registry.ts";
import { EnvironmentRpc, type EnvironmentRpcInput } from "../runtime.ts";
import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  EMPTY_TERMINAL_BUFFER_STATE,
} from "../../terminalSessionState.ts";

export function createTerminalEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    attach: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:attach",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.terminalAttach>) =>
        Stream.unwrap(
          EnvironmentRpc.pipe(
            Effect.map((rpc) =>
              rpc
                .subscribe(WS_METHODS.terminalAttach, input)
                .pipe(Stream.scan(EMPTY_TERMINAL_BUFFER_STATE, applyTerminalAttachStreamEvent)),
            ),
          ),
        ),
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:events",
      tag: WS_METHODS.subscribeTerminalEvents,
    }),
    metadata: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:metadata",
      subscribe: (_input: null) =>
        Stream.unwrap(
          EnvironmentRpc.pipe(
            Effect.map((rpc) =>
              rpc
                .subscribe(WS_METHODS.subscribeTerminalMetadata, {})
                .pipe(
                  Stream.scan(
                    [] as ReadonlyArray<TerminalSummary>,
                    applyTerminalMetadataStreamEvent,
                  ),
                ),
            ),
          ),
        ),
    }),
    open: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:open",
      tag: WS_METHODS.terminalOpen,
    }),
    write: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:write",
      tag: WS_METHODS.terminalWrite,
    }),
    resize: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:resize",
      tag: WS_METHODS.terminalResize,
    }),
    clear: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:clear",
      tag: WS_METHODS.terminalClear,
    }),
    restart: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:restart",
      tag: WS_METHODS.terminalRestart,
    }),
    close: createEnvironmentRpcMutation(runtime, {
      label: "environment-data:terminal:close",
      tag: WS_METHODS.terminalClose,
    }),
  };
}

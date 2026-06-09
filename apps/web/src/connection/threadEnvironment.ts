import { useAtomSet } from "@effect/atom-react";
import { createThreadEnvironmentAtoms } from "@t3tools/client-runtime/state/threads";

import { connectionAtomRuntime } from "./connectionRuntime";

const threadEnvironment = createThreadEnvironmentAtoms(connectionAtomRuntime);

export function useThreadActions() {
  return {
    create: useAtomSet(threadEnvironment.create, { mode: "promise" }),
    delete: useAtomSet(threadEnvironment.delete, { mode: "promise" }),
    archive: useAtomSet(threadEnvironment.archive, { mode: "promise" }),
    unarchive: useAtomSet(threadEnvironment.unarchive, { mode: "promise" }),
    updateMetadata: useAtomSet(threadEnvironment.updateMetadata, { mode: "promise" }),
    setRuntimeMode: useAtomSet(threadEnvironment.setRuntimeMode, { mode: "promise" }),
    setInteractionMode: useAtomSet(threadEnvironment.setInteractionMode, {
      mode: "promise",
    }),
    startTurn: useAtomSet(threadEnvironment.startTurn, { mode: "promise" }),
    interruptTurn: useAtomSet(threadEnvironment.interruptTurn, { mode: "promise" }),
    respondToApproval: useAtomSet(threadEnvironment.respondToApproval, { mode: "promise" }),
    respondToUserInput: useAtomSet(threadEnvironment.respondToUserInput, {
      mode: "promise",
    }),
    revertCheckpoint: useAtomSet(threadEnvironment.revertCheckpoint, {
      mode: "promise",
    }),
    stopSession: useAtomSet(threadEnvironment.stopSession, { mode: "promise" }),
  };
}

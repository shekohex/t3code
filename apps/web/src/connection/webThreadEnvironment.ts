import { useAtomSet } from "@effect/atom-react";
import { createThreadEnvironmentAtoms } from "@t3tools/client-runtime";

import { webConnectionAtomRuntime } from "./webConnectionRuntime";

const webThreadEnvironment = createThreadEnvironmentAtoms(webConnectionAtomRuntime);

export function useWebThreadActions() {
  return {
    create: useAtomSet(webThreadEnvironment.create, { mode: "promise" }),
    delete: useAtomSet(webThreadEnvironment.delete, { mode: "promise" }),
    archive: useAtomSet(webThreadEnvironment.archive, { mode: "promise" }),
    unarchive: useAtomSet(webThreadEnvironment.unarchive, { mode: "promise" }),
    updateMetadata: useAtomSet(webThreadEnvironment.updateMetadata, { mode: "promise" }),
    setRuntimeMode: useAtomSet(webThreadEnvironment.setRuntimeMode, { mode: "promise" }),
    setInteractionMode: useAtomSet(webThreadEnvironment.setInteractionMode, {
      mode: "promise",
    }),
    startTurn: useAtomSet(webThreadEnvironment.startTurn, { mode: "promise" }),
    interruptTurn: useAtomSet(webThreadEnvironment.interruptTurn, { mode: "promise" }),
    respondToApproval: useAtomSet(webThreadEnvironment.respondToApproval, { mode: "promise" }),
    respondToUserInput: useAtomSet(webThreadEnvironment.respondToUserInput, {
      mode: "promise",
    }),
    revertCheckpoint: useAtomSet(webThreadEnvironment.revertCheckpoint, {
      mode: "promise",
    }),
    stopSession: useAtomSet(webThreadEnvironment.stopSession, { mode: "promise" }),
  };
}

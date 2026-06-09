import { useAtomSet } from "@effect/atom-react";
import { createThreadEnvironmentAtoms } from "@t3tools/client-runtime";

import { mobileConnectionAtomRuntime } from "./mobileConnectionRuntime";

const mobileThreadEnvironment = createThreadEnvironmentAtoms(mobileConnectionAtomRuntime);

export function useMobileThreadActions() {
  return {
    create: useAtomSet(mobileThreadEnvironment.create, { mode: "promise" }),
    delete: useAtomSet(mobileThreadEnvironment.delete, { mode: "promise" }),
    archive: useAtomSet(mobileThreadEnvironment.archive, { mode: "promise" }),
    unarchive: useAtomSet(mobileThreadEnvironment.unarchive, { mode: "promise" }),
    updateMetadata: useAtomSet(mobileThreadEnvironment.updateMetadata, { mode: "promise" }),
    setRuntimeMode: useAtomSet(mobileThreadEnvironment.setRuntimeMode, { mode: "promise" }),
    setInteractionMode: useAtomSet(mobileThreadEnvironment.setInteractionMode, {
      mode: "promise",
    }),
    startTurn: useAtomSet(mobileThreadEnvironment.startTurn, { mode: "promise" }),
    interruptTurn: useAtomSet(mobileThreadEnvironment.interruptTurn, { mode: "promise" }),
    respondToApproval: useAtomSet(mobileThreadEnvironment.respondToApproval, {
      mode: "promise",
    }),
    respondToUserInput: useAtomSet(mobileThreadEnvironment.respondToUserInput, {
      mode: "promise",
    }),
    revertCheckpoint: useAtomSet(mobileThreadEnvironment.revertCheckpoint, {
      mode: "promise",
    }),
    stopSession: useAtomSet(mobileThreadEnvironment.stopSession, { mode: "promise" }),
  };
}

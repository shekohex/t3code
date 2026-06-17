import { useAtomSet } from "@effect/atom-react";
import {
  executeAtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

export function useAtomCommand<A, E, W>(
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const set = useAtomSet(atom, { mode: "promiseExit" });
  const label =
    typeof options === "string" ? options : (options?.label ?? atom.label?.[0] ?? "atom command");
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    (value: W) => executeAtomCommand(() => set(value), { label, reportFailure, reportDefect }),
    [label, reportDefect, reportFailure, set],
  );
}

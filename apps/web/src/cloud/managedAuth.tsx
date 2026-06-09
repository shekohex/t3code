import { useAuth } from "@clerk/react";
import {
  createManagedRelaySession,
  ManagedRelayClient,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import { useEffect, useRef, type ReactNode } from "react";

import { useEnvironmentConnectionActions } from "../connection/connectionState";
import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

let relayTokenProvider: (() => Promise<string | null>) | null = null;

export async function readManagedRelayClerkToken(): Promise<string | null> {
  return relayTokenProvider?.() ?? null;
}

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { removeRelayEnvironments } = useEnvironmentConnectionActions();
  const observedAccountRef = useRef<string | null | undefined>(undefined);
  const accountTransitionRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    let cancelled = false;
    const previousAccount = observedAccountRef.current;
    const nextAccount = isSignedIn && userId ? userId : null;
    observedAccountRef.current = nextAccount;

    const queueAccountCleanup = () => {
      accountTransitionRef.current = accountTransitionRef.current.then(async () => {
        const results = await Promise.allSettled([
          removeRelayEnvironments(),
          runtime.runPromise(
            ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
          ),
        ]);
        for (const result of results) {
          if (result.status === "rejected") {
            console.warn("[t3-cloud] cloud account cleanup failed", result.reason);
          }
        }
      });
      return accountTransitionRef.current;
    };

    relayTokenProvider = isSignedIn ? () => getToken(resolveRelayClerkTokenOptions()) : null;
    if (!isSignedIn || !userId) {
      setManagedRelaySession(appAtomRegistry, null);
      if (previousAccount !== null) {
        void queueAccountCleanup();
      }
    } else {
      if (previousAccount !== undefined && previousAccount !== null && previousAccount !== userId) {
        setManagedRelaySession(appAtomRegistry, null);
        void queueAccountCleanup().then(() => {
          if (!cancelled) {
            setManagedRelaySession(
              appAtomRegistry,
              createManagedRelaySession({
                accountId: userId,
                readClerkToken: () => getToken(resolveRelayClerkTokenOptions()),
              }),
            );
          }
        });
      } else {
        void accountTransitionRef.current.then(() => {
          if (!cancelled) {
            setManagedRelaySession(
              appAtomRegistry,
              createManagedRelaySession({
                accountId: userId,
                readClerkToken: () => getToken(resolveRelayClerkTokenOptions()),
              }),
            );
          }
        });
      }
    }
    return () => {
      cancelled = true;
      relayTokenProvider = null;
      setManagedRelaySession(appAtomRegistry, null);
    };
  }, [getToken, isLoaded, isSignedIn, removeRelayEnvironments, userId]);

  return children;
}

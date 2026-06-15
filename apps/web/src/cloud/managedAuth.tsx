import { useAuth } from "@clerk/react";
import {
  createManagedRelaySession,
  ManagedRelayClient,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import { useEffect, useRef, type ReactNode } from "react";

import { useEnvironmentConnectionActions } from "../state/environments";
import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

let relayTokenProvider: (() => Promise<string | null>) | null = null;

export async function readManagedRelayClerkToken(): Promise<string | null> {
  return relayTokenProvider?.() ?? null;
}

export function deactivateManagedRelayAuthentication(): void {
  relayTokenProvider = null;
  setManagedRelaySession(appAtomRegistry, null);
}

export function activateManagedRelayAuthentication(
  accountId: string,
  readClerkToken: () => Promise<string | null>,
): void {
  relayTokenProvider = readClerkToken;
  setManagedRelaySession(
    appAtomRegistry,
    createManagedRelaySession({
      accountId,
      readClerkToken,
    }),
  );
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

    if (!isSignedIn || !userId) {
      deactivateManagedRelayAuthentication();
      if (previousAccount !== null) {
        void queueAccountCleanup();
      }
    } else {
      const tokenProvider = () => getToken(resolveRelayClerkTokenOptions());
      const activateSession = () => {
        if (!cancelled) {
          activateManagedRelayAuthentication(userId, tokenProvider);
        }
      };
      if (previousAccount !== undefined && previousAccount !== null && previousAccount !== userId) {
        deactivateManagedRelayAuthentication();
        void queueAccountCleanup().then(activateSession);
      } else {
        void accountTransitionRef.current.then(activateSession);
      }
    }
    return () => {
      cancelled = true;
      deactivateManagedRelayAuthentication();
    };
  }, [getToken, isLoaded, isSignedIn, removeRelayEnvironments, userId]);

  return children;
}

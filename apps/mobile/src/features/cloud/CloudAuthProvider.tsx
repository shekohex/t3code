import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  createManagedRelaySession,
  ManagedRelayClient,
  setManagedRelaySession,
} from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import { type ReactNode, useEffect, useRef } from "react";

import { useEnvironmentConnectionActions } from "../../connection/connectionState";
import { runtime } from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  setAgentAwarenessRelayTokenProvider,
  unregisterAgentAwarenessDeviceForCurrentUser,
} from "../agent-awareness/remoteRegistration";
import { resolveCloudPublicConfig, resolveRelayClerkTokenOptions } from "./publicConfig";

function resetManagedRelayTokenCache(): Promise<void> {
  return runtime.runPromise(
    ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
  );
}

function CloudAuthBridge(props: { readonly children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const { removeRelayEnvironments } = useEnvironmentConnectionActions();
  const previousTokenProviderRef = useRef<{
    readonly userId: string;
    readonly provider: () => Promise<string | null>;
  } | null>(null);
  const observedAccountRef = useRef<string | null | undefined>(undefined);
  const accountTransitionRef = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) {
      return;
    }

    const previousObservedAccount = observedAccountRef.current;
    const nextAccount = isSignedIn && userId ? userId : null;
    observedAccountRef.current = nextAccount;

    const queueAccountCleanup = (
      previous: {
        readonly userId: string;
        readonly provider: () => Promise<string | null>;
      } | null,
    ) => {
      accountTransitionRef.current = accountTransitionRef.current.then(async () => {
        const cleanup = [
          resetManagedRelayTokenCache(),
          removeRelayEnvironments(),
          ...(previous
            ? [runtime.runPromise(unregisterAgentAwarenessDeviceForCurrentUser(previous.provider))]
            : []),
        ];
        const results = await Promise.allSettled(cleanup);
        for (const result of results) {
          if (result.status === "rejected") {
            console.warn("[t3-cloud] cloud account cleanup failed", result.reason);
          }
        }
      });
      return accountTransitionRef.current;
    };

    if (!isSignedIn || !userId) {
      const previous = previousTokenProviderRef.current;
      previousTokenProviderRef.current = null;
      setAgentAwarenessRelayTokenProvider(null);
      setManagedRelaySession(appAtomRegistry, null);
      if (previousObservedAccount !== null) {
        void queueAccountCleanup(previous);
      }
      return;
    }

    const previous = previousTokenProviderRef.current;
    const tokenProvider = () => getToken(resolveRelayClerkTokenOptions());
    const activateSession = () => {
      if (cancelled) {
        return;
      }
      previousTokenProviderRef.current = { userId, provider: tokenProvider };
      setAgentAwarenessRelayTokenProvider(tokenProvider, userId);
      setManagedRelaySession(
        appAtomRegistry,
        createManagedRelaySession({
          accountId: userId,
          readClerkToken: tokenProvider,
        }),
      );
    };
    if (
      previousObservedAccount !== undefined &&
      previousObservedAccount !== null &&
      previousObservedAccount !== userId
    ) {
      previousTokenProviderRef.current = null;
      setAgentAwarenessRelayTokenProvider(null);
      setManagedRelaySession(appAtomRegistry, null);
      void queueAccountCleanup(previous).then(activateSession);
    } else {
      void accountTransitionRef.current.then(activateSession);
    }

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, removeRelayEnvironments, userId]);

  useEffect(
    () => () => {
      previousTokenProviderRef.current = null;
      setAgentAwarenessRelayTokenProvider(null);
      setManagedRelaySession(appAtomRegistry, null);
    },
    [],
  );

  return props.children;
}

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  const config = resolveCloudPublicConfig();
  const publishableKey = config.clerk.publishableKey;
  const relayUrl = config.relay.url;

  useEffect(() => {
    if (!publishableKey || !relayUrl) {
      setAgentAwarenessRelayTokenProvider(null);
      setManagedRelaySession(appAtomRegistry, null);
    }
  }, [publishableKey, relayUrl]);

  if (!publishableKey || !relayUrl) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <CloudAuthBridge>{props.children}</CloudAuthBridge>
    </ClerkProvider>
  );
}

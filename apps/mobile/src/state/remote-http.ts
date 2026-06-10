import { useAtomValue } from "@effect/atom-react";
import { ManagedRelayDpopSigner } from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

interface DpopRequest {
  readonly url: string;
  readonly accessToken: string;
}

const remoteHttpHeadersAtom = Atom.family((key: string | null) => {
  return connectionAtomRuntime.atom(
    key === null
      ? Effect.succeed<Readonly<Record<string, string>> | null>(null)
      : Effect.gen(function* () {
          const request = JSON.parse(key) as DpopRequest;
          const signer = yield* ManagedRelayDpopSigner;
          const proof = yield* signer.createProof({
            method: "GET",
            url: request.url,
            accessToken: request.accessToken,
          });
          return {
            Authorization: `DPoP ${request.accessToken}`,
            DPoP: proof,
          } satisfies Readonly<Record<string, string>>;
        }),
    { initialValue: null },
  );
});

export function useRemoteHttpHeaders(input: {
  readonly url: string | null;
  readonly bearerToken: string | null;
  readonly dpopAccessToken?: string;
}): {
  readonly headers: Readonly<Record<string, string>> | null;
  readonly isReady: boolean;
} {
  const dpopKey =
    input.url !== null && input.dpopAccessToken
      ? JSON.stringify({
          url: input.url,
          accessToken: input.dpopAccessToken,
        } satisfies DpopRequest)
      : null;
  const result = useAtomValue(remoteHttpHeadersAtom(dpopKey));

  if (input.bearerToken) {
    return {
      headers: { Authorization: `Bearer ${input.bearerToken}` },
      isReady: true,
    };
  }
  if (dpopKey === null) {
    return { headers: null, isReady: true };
  }

  const headers = Option.getOrNull(AsyncResult.value(result));
  return {
    headers,
    isReady: headers !== null,
  };
}

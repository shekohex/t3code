import {
  exchangeRemoteDpopAccessToken,
  type RemoteEnvironmentAuthError,
  resolveRemoteDpopWebSocketConnectionUrl,
  resolveRemoteWebSocketConnectionUrl,
} from "./remote.ts";
import { environmentMismatchError, mapRemoteEnvironmentError } from "../connection/errors.ts";
import { ConnectionTransientError } from "../connection/model.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ClientPresentation } from "../platform/capabilities.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { RemoteEnvironmentAuthorization } from "./service.ts";
import { RemoteDpopAccessToken, RemoteDpopAccessTokenStore } from "./tokenStore.ts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

function mapDpopSocketError(error: RemoteEnvironmentAuthError | ConnectionTransientError) {
  return error._tag === "ConnectionTransientError" ? error : mapRemoteEnvironmentError(error);
}

function shouldRefreshDpopAccessToken(
  error: RemoteEnvironmentAuthError | ConnectionTransientError,
): boolean {
  return (
    error._tag === "EnvironmentAuthInvalidError" || error._tag === "EnvironmentScopeRequiredError"
  );
}

const fetchDescriptor = Effect.fn("clientRuntime.connection.remote.fetchDescriptor")(function* (
  httpBaseUrl: string,
) {
  return yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
    Effect.mapError(mapRemoteEnvironmentError),
  );
});

export const remoteEnvironmentAuthorizationLayer = Layer.effect(
  RemoteEnvironmentAuthorization,
  Effect.gen(function* () {
    const signer = yield* ManagedRelayDpopSigner;
    const presentation = yield* ClientPresentation;
    const tokenStore = yield* RemoteDpopAccessTokenStore;
    const httpClient = yield* HttpClient.HttpClient;

    const authorizeBearer = Effect.fn("clientRuntime.connection.remote.authorizeBearer")(
      function* (input: {
        readonly expectedEnvironmentId: Parameters<
          RemoteEnvironmentAuthorization["Service"]["authorizeBearer"]
        >[0]["expectedEnvironmentId"];
        readonly httpBaseUrl: string;
        readonly wsBaseUrl: string;
        readonly bearerToken: string;
      }) {
        const descriptor = yield* fetchDescriptor(input.httpBaseUrl).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
        );
        if (descriptor.environmentId !== input.expectedEnvironmentId) {
          return yield* environmentMismatchError({
            expected: input.expectedEnvironmentId,
            actual: descriptor.environmentId,
          });
        }
        const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
          wsBaseUrl: input.wsBaseUrl,
          httpBaseUrl: input.httpBaseUrl,
          bearerToken: input.bearerToken,
        }).pipe(
          Effect.mapError(mapRemoteEnvironmentError),
          Effect.provideService(HttpClient.HttpClient, httpClient),
        );
        return {
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          httpBaseUrl: input.httpBaseUrl,
          socketUrl,
        };
      },
    );

    const createDpopSocketUrl = Effect.fn("clientRuntime.connection.remote.createDpopSocketUrl")(
      function* (token: RemoteDpopAccessToken) {
        const ticketProof = yield* signer
          .createProof({
            method: "POST",
            url: environmentEndpointUrl(token.endpoint.httpBaseUrl, "/api/auth/websocket-ticket"),
            accessToken: token.accessToken,
          })
          .pipe(
            Effect.mapError(
              () =>
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  message: "Could not create the websocket authorization proof.",
                }),
            ),
          );
        return yield* resolveRemoteDpopWebSocketConnectionUrl({
          wsBaseUrl: token.endpoint.wsBaseUrl,
          httpBaseUrl: token.endpoint.httpBaseUrl,
          accessToken: token.accessToken,
          dpopProof: ticketProof,
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
      },
    );

    const authorizeDpop = Effect.fn("clientRuntime.connection.remote.authorizeDpop")(
      function* (input: {
        readonly expectedEnvironmentId: Parameters<
          RemoteEnvironmentAuthorization["Service"]["authorizeDpop"]
        >[0]["expectedEnvironmentId"];
        readonly obtainBootstrap: Parameters<
          RemoteEnvironmentAuthorization["Service"]["authorizeDpop"]
        >[0]["obtainBootstrap"];
      }) {
        const thumbprint = yield* signer.thumbprint.pipe(
          Effect.mapError(
            () =>
              new ConnectionTransientError({
                reason: "remote-unavailable",
                message: "Could not load the environment authorization key.",
              }),
          ),
          Effect.withSpan("environment.authorization.dpopKey.resolve"),
        );
        const now = yield* Clock.currentTimeMillis;
        const cached = yield* tokenStore
          .get(input.expectedEnvironmentId)
          .pipe(Effect.withSpan("environment.authorization.accessToken.cache"));
        if (
          Option.isSome(cached) &&
          cached.value.environmentId === input.expectedEnvironmentId &&
          cached.value.dpopThumbprint === thumbprint &&
          cached.value.expiresAtEpochMs > now + TOKEN_EXPIRY_SAFETY_MARGIN_MS
        ) {
          yield* Effect.annotateCurrentSpan({
            "connection.remote_token_cache": "hit",
          });
          const cachedSocket = yield* createDpopSocketUrl(cached.value).pipe(Effect.result);
          if (Result.isSuccess(cachedSocket)) {
            return {
              environmentId: cached.value.environmentId,
              label: cached.value.label,
              httpBaseUrl: cached.value.endpoint.httpBaseUrl,
              socketUrl: cachedSocket.success,
            };
          }
          if (!shouldRefreshDpopAccessToken(cachedSocket.failure)) {
            return yield* mapDpopSocketError(cachedSocket.failure);
          }
          yield* tokenStore
            .remove(input.expectedEnvironmentId)
            .pipe(Effect.withSpan("environment.authorization.accessToken.remove"));
        }

        yield* Effect.annotateCurrentSpan({
          "connection.remote_token_cache": "miss",
        });
        const bootstrap = yield* input.obtainBootstrap;
        const descriptor = yield* fetchDescriptor(bootstrap.endpoint.httpBaseUrl).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.withSpan("environment.authorization.descriptor"),
        );
        if (descriptor.environmentId !== input.expectedEnvironmentId) {
          return yield* environmentMismatchError({
            expected: input.expectedEnvironmentId,
            actual: descriptor.environmentId,
          });
        }
        const bootstrapProof = yield* signer
          .createProof({
            method: "POST",
            url: environmentEndpointUrl(bootstrap.endpoint.httpBaseUrl, "/oauth/token"),
          })
          .pipe(
            Effect.mapError(
              () =>
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  message: "Could not create the environment authorization proof.",
                }),
            ),
          );
        const access = yield* exchangeRemoteDpopAccessToken({
          httpBaseUrl: bootstrap.endpoint.httpBaseUrl,
          credential: bootstrap.credential,
          dpopProof: bootstrapProof,
          scopes: presentation.scopes,
          clientMetadata: presentation.metadata,
        }).pipe(
          Effect.mapError(mapRemoteEnvironmentError),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.withSpan("environment.authorization.accessToken.exchange"),
        );
        const issuedAt = yield* Clock.currentTimeMillis;
        const token = new RemoteDpopAccessToken({
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          endpoint: bootstrap.endpoint,
          accessToken: access.access_token,
          expiresAtEpochMs: issuedAt + access.expires_in * 1_000,
          dpopThumbprint: thumbprint,
        });
        const socketUrl = yield* createDpopSocketUrl(token).pipe(
          Effect.mapError(mapDpopSocketError),
        );
        yield* tokenStore
          .put(token)
          .pipe(Effect.withSpan("environment.authorization.accessToken.persist"));
        return {
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          httpBaseUrl: bootstrap.endpoint.httpBaseUrl,
          socketUrl,
        };
      },
    );

    return RemoteEnvironmentAuthorization.of({
      authorizeBearer,
      authorizeDpop: (input) =>
        authorizeDpop(input).pipe(Effect.withSpan("environment.authorization")),
    });
  }),
);

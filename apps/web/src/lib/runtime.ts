import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { remoteHttpClientLayer } from "@t3tools/client-runtime";
import {
  PrimaryEnvironmentHttpClient,
  primaryEnvironmentHttpClientLive,
} from "../environments/primary/httpClient";
import { primaryEnvironmentHttpLayer } from "../environments/primary/httpLayer";

import { browserCryptoLayer } from "../cloud/dpop";
import { webManagedRelayClientLayer } from "../cloud/managedRelayLayer";
import { resolveCloudPublicConfig } from "../cloud/publicConfig";

function configuredRelayUrl(): string {
  return resolveCloudPublicConfig().relayUrl ?? "http://relay.invalid";
}

const webHttpClientLayer = remoteHttpClientLayer(globalThis.fetch);
const primaryEnvironmentClientLayer = primaryEnvironmentHttpClientLive.pipe(
  Layer.provide(primaryEnvironmentHttpLayer),
);

export const remoteHttpRuntime = ManagedRuntime.make(webHttpClientLayer);

export const webRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    webHttpClientLayer,
    primaryEnvironmentClientLayer,
    browserCryptoLayer,
    webManagedRelayClientLayer(configuredRelayUrl()).pipe(
      Layer.provide(Layer.mergeAll(webHttpClientLayer, browserCryptoLayer)),
    ),
  ),
);

export type PrimaryHttpEffectRunner = <A, E>(
  effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient>,
) => Promise<A>;

const livePrimaryHttpRunner: PrimaryHttpEffectRunner = (effect) => webRuntime.runPromise(effect);

let primaryHttpRunner = livePrimaryHttpRunner;

export const runPrimaryHttp = <A, E>(effect: Effect.Effect<A, E, PrimaryEnvironmentHttpClient>) =>
  primaryHttpRunner(effect);

export function __setPrimaryHttpRunnerForTests(runner?: PrimaryHttpEffectRunner): void {
  primaryHttpRunner = runner ?? livePrimaryHttpRunner;
}

import * as NodeAssert from "node:assert/strict";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PiAgentDriver } from "./PiAgentDriver.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die("disabled Pi snapshot must not request provider updates")),
);

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "pi-agent-driver-test",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestHttpClientLive),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
);

it.layer(testLayer)("PiAgentDriver", (it) => {
  it.effect("reads update-check settings for each snapshot refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsRef = yield* Ref.make({
          ...DEFAULT_SERVER_SETTINGS,
          enableProviderUpdateChecks: true,
        });
        const observedUpdateCheckSettings = yield* Ref.make<ReadonlyArray<boolean>>([]);
        const serverSettings: ServerSettingsService["Service"] = {
          start: Effect.void,
          ready: Effect.void,
          getSettings: Ref.get(settingsRef).pipe(
            Effect.tap((settings) =>
              Ref.update(observedUpdateCheckSettings, (observed) => [
                ...observed,
                settings.enableProviderUpdateChecks,
              ]),
            ),
          ),
          updateSettings: () => Effect.die("not used by this test"),
          streamChanges: Stream.empty,
        };
        const instance = yield* PiAgentDriver.create({
          instanceId: ProviderInstanceId.make("piAgent"),
          displayName: undefined,
          environment: [],
          enabled: false,
          config: PiAgentDriver.defaultConfig(),
        }).pipe(Effect.provideService(ServerSettingsService, serverSettings));

        yield* Ref.update(settingsRef, (settings) => ({
          ...settings,
          enableProviderUpdateChecks: false,
        }));
        yield* instance.snapshot.refresh;

        NodeAssert.deepEqual(yield* Ref.get(observedUpdateCheckSettings), [true, false]);
      }),
    ),
  );
});

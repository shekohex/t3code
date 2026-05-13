import { afterEach, describe, expect, it } from "vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  applyBundledProviderCompatibilityAdvisory,
  clearProviderCompatibilityCacheForTests,
  createProviderCompatibilityAdvisory,
  enrichProviderSnapshotWithCompatibilityAdvisory,
  type ProviderCompatibilityDocument,
} from "./providerCompatibility.ts";

const codexDriver = ProviderDriverKind.make("codex");

const baseProvider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: codexDriver,
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "0.130.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

function jsonHttpClient(payload: unknown, status = 200): HttpClient.HttpClient {
  return HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => {
  clearProviderCompatibilityCacheForTests();
});

describe("provider compatibility", () => {
  it("selects policies by T3 Code version range", () => {
    const document: ProviderCompatibilityDocument = {
      version: 1,
      policies: [
        {
          t3CodeRange: "<0.1.0",
          driver: codexDriver,
          recommendedRange: "<0.130.0",
          recommendedVersion: "0.129.0",
          ranges: [{ status: "broken", range: ">=0.130.0" }],
        },
        {
          t3CodeRange: ">=0.1.0",
          driver: codexDriver,
          recommendedRange: ">=0.130.0",
          recommendedVersion: "0.130.0",
          ranges: [{ status: "supported", range: ">=0.130.0" }],
        },
      ],
    };

    expect(
      createProviderCompatibilityAdvisory({
        driver: codexDriver,
        currentVersion: "0.130.0",
        document,
        t3CodeVersion: "0.0.22",
      }),
    ).toMatchObject({
      status: "broken",
      recommendedVersion: "0.129.0",
    });
  });

  it("enriches snapshots from the remote compatibility map when available", async () => {
    const remoteDocument = {
      version: 1,
      policies: [
        {
          t3CodeRange: ">=0.0.0",
          driver: "codex",
          recommendedRange: "<0.130.0",
          recommendedVersion: "0.129.0",
          ranges: [{ status: "broken", range: ">=0.130.0" }],
        },
      ],
    };

    const enriched = await Effect.runPromise(
      enrichProviderSnapshotWithCompatibilityAdvisory(baseProvider).pipe(
        Effect.provideService(HttpClient.HttpClient, jsonHttpClient(remoteDocument)),
      ),
    );

    expect(enriched.status).toBe("error");
    expect(enriched.compatibilityAdvisory).toMatchObject({
      status: "broken",
      recommendedVersion: "0.129.0",
    });
  });

  it("falls back to the bundled map when the remote compatibility fetch fails", async () => {
    const enriched = await Effect.runPromise(
      enrichProviderSnapshotWithCompatibilityAdvisory({
        ...baseProvider,
        version: "0.128.0",
      }).pipe(Effect.provideService(HttpClient.HttpClient, jsonHttpClient({}, 404))),
    );

    expect(enriched.status).toBe("error");
    expect(enriched.compatibilityAdvisory).toMatchObject({
      status: "broken",
      recommendedVersion: "0.129.0",
    });
  });

  it("remote advisory demotes status set by bundled advisory", async () => {
    // The bundled document marks <0.129.0 as "broken", so 0.128.0 triggers
    // an error advisory on the initial snapshot.
    const snapshotAfterBundled = applyBundledProviderCompatibilityAdvisory({
      snapshot: { ...baseProvider, version: "0.128.0" },
      driver: codexDriver,
      currentVersion: "0.128.0",
    });
    expect(snapshotAfterBundled.status).toBe("error");
    expect(snapshotAfterBundled.compatibilityAdvisory?.severity).toBe("error");

    // The remote document relaxes the policy: 0.128.0 is now "supported".
    const remoteDocument = {
      version: 1,
      policies: [
        {
          t3CodeRange: ">=0.0.0",
          driver: "codex",
          recommendedRange: ">=0.129.0",
          recommendedVersion: "0.129.0",
          ranges: [{ status: "supported", range: ">=0.128.0" }],
        },
      ],
    };

    const enriched = await Effect.runPromise(
      enrichProviderSnapshotWithCompatibilityAdvisory({
        ...snapshotAfterBundled,
        instanceId: baseProvider.instanceId,
        driver: baseProvider.driver,
      }).pipe(Effect.provideService(HttpClient.HttpClient, jsonHttpClient(remoteDocument))),
    );

    expect(enriched.status).toBe("ready");
    expect(enriched.compatibilityAdvisory?.severity).toBe("info");
    expect(enriched.message).toBeUndefined();
  });
});

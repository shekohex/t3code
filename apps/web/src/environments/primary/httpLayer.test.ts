import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import { __resetDesktopPrimaryAuthForTests } from "./desktopAuth";
import { primaryEnvironmentHttpLayer } from "./httpLayer";

describe("primary environment HTTP layer", () => {
  afterEach(() => {
    __resetDesktopPrimaryAuthForTests();
    Reflect.deleteProperty(globalThis, "window");
    vi.unstubAllGlobals();
  });

  it.effect("uses cookie credentials for browser primary environments", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          location: {
            href: "http://127.0.0.1:3773/settings",
            origin: "http://127.0.0.1:3773",
          },
        },
      });

      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session").pipe(
        Effect.provide(primaryEnvironmentHttpLayer),
      );

      expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
    }),
  );

  it.effect("uses bearer auth without cookies for desktop-managed primaries", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    return Effect.gen(function* () {
      vi.stubGlobal("fetch", fetchMock);
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          location: { origin: "t3code://app" },
          desktopBridge: {
            getLocalEnvironmentBootstrap: () => ({
              label: "Local environment",
              httpBaseUrl: "http://127.0.0.1:3773",
              wsBaseUrl: "ws://127.0.0.1:3773",
              bootstrapToken: "desktop-bootstrap-token",
            }),
            getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-bearer-token"),
          } as unknown as DesktopBridge,
        },
      });

      yield* HttpClient.get("http://127.0.0.1:3773/api/connect/link-state");

      expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("omit");
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
        "Bearer desktop-bearer-token",
      );
    }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
  });
});

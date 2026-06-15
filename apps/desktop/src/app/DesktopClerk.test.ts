import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

const { createClerkBridgeMock, storageAdapter, storageMock } = vi.hoisted(() => ({
  createClerkBridgeMock: vi.fn(),
  storageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  storageMock: vi.fn(),
}));

vi.mock("@clerk/electron", () => ({
  createClerkBridge: createClerkBridgeMock,
}));

vi.mock("@clerk/electron/storage", () => ({
  storage: storageMock,
}));

import { createDesktopClerkBridge } from "./DesktopClerk.ts";

describe("DesktopClerk", () => {
  it.each([
    { isDevelopment: true, scheme: "t3code-dev" },
    { isDevelopment: false, scheme: "t3code" },
  ])("configures the SDK with the $scheme renderer origin", ({ isDevelopment, scheme }) => {
    const bridge = { cleanup: vi.fn() };
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue(bridge);

    assert.equal(createDesktopClerkBridge("/tmp/t3-state", isDevelopment), bridge);
    assert.deepEqual(storageMock.mock.calls, [[{ path: "/tmp/t3-state" }]]);
    assert.deepEqual(createClerkBridgeMock.mock.calls, [
      [
        {
          storage: storageAdapter,
          renderer: { scheme, host: "app" },
        },
      ],
    ]);
    storageMock.mockClear();
    createClerkBridgeMock.mockClear();
  });
});

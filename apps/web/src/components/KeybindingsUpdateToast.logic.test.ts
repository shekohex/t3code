import { DEFAULT_SERVER_SETTINGS, type ServerConfigUpdatedPayload } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ServerConfigUpdatedNotification } from "../rpc/serverState";
import {
  createKeybindingsUpdateToastController,
  KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS,
} from "./KeybindingsUpdateToast.logic";

const payload = {
  issues: [],
  providers: [],
  settings: DEFAULT_SERVER_SETTINGS,
} satisfies ServerConfigUpdatedPayload;

function notification(
  id: number,
  overrides: Partial<ServerConfigUpdatedNotification> = {},
): ServerConfigUpdatedNotification {
  return {
    id,
    payload,
    source: "keybindingsUpdated",
    ...overrides,
  };
}

describe("keybindings update toast policy", () => {
  it("ignores the notification that was already cached when the consumer mounted", () => {
    const controller = createKeybindingsUpdateToastController({
      initialNotificationId: 4,
    });

    expect(controller.handle(notification(4))).toBeNull();
  });

  it("coalesces repeated successful reload notifications during the cooldown", () => {
    let now = 1_000;
    const controller = createKeybindingsUpdateToastController({
      initialNotificationId: 0,
      now: () => now,
    });

    expect(controller.handle(notification(1))).toEqual({ _tag: "Success" });

    now += KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS - 1;
    expect(controller.handle(notification(2))).toBeNull();

    now += 1;
    expect(controller.handle(notification(3))).toEqual({ _tag: "Success" });
  });

  it("surfaces keybinding configuration issues", () => {
    const controller = createKeybindingsUpdateToastController({
      initialNotificationId: 0,
    });

    expect(
      controller.handle(
        notification(1, {
          payload: {
            ...payload,
            issues: [
              {
                kind: "keybindings.malformed-config",
                message: "Expected JSON array",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      _tag: "InvalidConfiguration",
      message: "Expected JSON array",
    });
  });

  it("ignores unrelated server config notifications", () => {
    const controller = createKeybindingsUpdateToastController({
      initialNotificationId: 0,
    });

    expect(
      controller.handle(
        notification(1, {
          source: "settingsUpdated",
        }),
      ),
    ).toBeNull();
  });
});

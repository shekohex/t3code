import type { ServerConfigUpdatedNotification } from "../rpc/serverState";

export const KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS = 2_000;

export type KeybindingsUpdateToastDecision =
  | { readonly _tag: "Success" }
  | { readonly _tag: "InvalidConfiguration"; readonly message: string };

export interface KeybindingsUpdateToastController {
  readonly handle: (
    notification: ServerConfigUpdatedNotification | null,
  ) => KeybindingsUpdateToastDecision | null;
}

export function createKeybindingsUpdateToastController(input: {
  readonly initialNotificationId: number;
  readonly now?: () => number;
}): KeybindingsUpdateToastController {
  const now = input.now ?? Date.now;
  let seenNotificationId = input.initialNotificationId;
  let lastSuccessToastAt: number | null = null;

  return {
    handle: (notification) => {
      if (notification === null || notification.id <= seenNotificationId) {
        return null;
      }

      seenNotificationId = notification.id;
      if (notification.source !== "keybindingsUpdated") {
        return null;
      }

      const issue = notification.payload.issues.find((entry) =>
        entry.kind.startsWith("keybindings."),
      );
      if (issue) {
        return {
          _tag: "InvalidConfiguration",
          message: issue.message,
        };
      }

      const currentTime = now();
      if (
        lastSuccessToastAt !== null &&
        currentTime - lastSuccessToastAt < KEYBINDINGS_SUCCESS_TOAST_COOLDOWN_MS
      ) {
        return null;
      }

      lastSuccessToastAt = currentTime;
      return { _tag: "Success" };
    },
  };
}

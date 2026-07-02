import { expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "./providerInstance.ts";
import { PROVIDER_DISPLAY_NAMES } from "./model.ts";

it("uses Pi Agent as the Pi provider display name", () => {
  expect(PROVIDER_DISPLAY_NAMES[ProviderDriverKind.make("piAgent")]).toBe("Pi Agent");
});

import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export interface DesktopClerkShape {
  readonly configure: Effect.Effect<
    void,
    never,
    | DesktopEnvironment.DesktopEnvironment
    | ElectronApp.ElectronApp
    | ElectronWindow.ElectronWindow
    | Scope.Scope
  >;
}

export class DesktopClerk extends Context.Service<DesktopClerk, DesktopClerkShape>()(
  "@t3tools/desktop/app/DesktopClerk",
) {}

export function createDesktopClerkBridge(stateDir: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: stateDir }),
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
    },
  });
}

const make = DesktopClerk.of({
  configure: Effect.gen(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
    const runPromise = Effect.runPromiseWith(context);

    if (!(yield* electronApp.requestSingleInstanceLock)) {
      yield* electronApp.quit;
      return yield* Effect.interrupt;
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => createDesktopClerkBridge(environment.stateDir, environment.isDevelopment)),
      (bridge) => Effect.sync(() => bridge.cleanup()),
    );

    yield* electronApp.on("second-instance", () => {
      void runPromise(
        Effect.gen(function* () {
          const mainWindow = yield* electronWindow.currentMainOrFirst;
          if (Option.isSome(mainWindow)) {
            yield* electronWindow.reveal(mainWindow.value);
          }
        }),
      );
    });
  }).pipe(Effect.withSpan("desktop.clerk.configure")),
});

export const layer = Layer.succeed(DesktopClerk, make);

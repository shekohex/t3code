import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "t3code";
export const DESKTOP_DEVELOPMENT_SCHEME = "t3code-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Data.TaggedError(
  "ElectronProtocolRegistrationError",
)<{
  readonly scheme: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Failed to register ${this.scheme}: protocol.`;
  }
}

export interface ElectronProtocolShape {
  readonly registerDesktopProtocol: (
    scheme: string,
    targetOrigin: URL,
  ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
}

export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
  "@t3tools/desktop/electron/ElectronProtocol",
) {}

function proxyRequest(request: Request, targetOrigin: URL): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== DESKTOP_HOST) {
    return Promise.resolve(new Response(null, { status: 404 }));
  }

  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, targetOrigin);
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  return Electron.net.fetch(targetUrl.toString(), init);
}

const make = Effect.gen(function* () {
  const registered = yield* Ref.make(false);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (scheme: string, targetOrigin: URL) {
      if (yield* Ref.get(registered)) return;

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(scheme, (request) => proxyRequest(request, targetOrigin));
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme, cause }),
        }).pipe(Effect.andThen(Ref.set(registered, true))),
        () =>
          Effect.sync(() => {
            Electron.protocol.unhandle(scheme);
          }).pipe(Effect.andThen(Ref.set(registered, false))),
      );
    },
  );

  return ElectronProtocol.of({ registerDesktopProtocol });
});

export const layer = Layer.effect(ElectronProtocol, make);

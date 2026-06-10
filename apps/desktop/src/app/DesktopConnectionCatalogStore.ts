import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorageService.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const ConnectionCatalogDocument = Schema.Struct({
  version: Schema.Literal(1),
  encryptedCatalog: Schema.String,
});
type ConnectionCatalogDocument = typeof ConnectionCatalogDocument.Type;

const ConnectionCatalogDocumentJson = fromLenientJson(ConnectionCatalogDocument);
const decodeConnectionCatalogDocumentJson = Schema.decodeEffect(ConnectionCatalogDocumentJson);
const encodeConnectionCatalogDocumentJson = Schema.encodeEffect(ConnectionCatalogDocumentJson);

export class DesktopConnectionCatalogStoreWriteError extends Data.TaggedError(
  "DesktopConnectionCatalogStoreWriteError",
)<{
  readonly cause: PlatformError.PlatformError | Schema.SchemaError;
}> {
  override get message() {
    return `Failed to write desktop connection catalog: ${this.cause.message}`;
  }
}

export class DesktopConnectionCatalogStoreDecodeError extends Data.TaggedError(
  "DesktopConnectionCatalogStoreDecodeError",
)<{
  readonly cause: Encoding.EncodingError;
}> {
  override get message() {
    return "Failed to decode the desktop connection catalog.";
  }
}

export interface DesktopConnectionCatalogStoreShape {
  readonly get: Effect.Effect<
    Option.Option<string>,
    | DesktopConnectionCatalogStoreDecodeError
    | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
    | ElectronSafeStorage.ElectronSafeStorageDecryptError
  >;
  readonly set: (
    catalog: string,
  ) => Effect.Effect<
    boolean,
    | DesktopConnectionCatalogStoreWriteError
    | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
    | ElectronSafeStorage.ElectronSafeStorageEncryptError
  >;
  readonly clear: Effect.Effect<void>;
}

export class DesktopConnectionCatalogStore extends Context.Service<
  DesktopConnectionCatalogStore,
  DesktopConnectionCatalogStoreShape
>()("@t3tools/desktop/app/DesktopConnectionCatalogStore") {}

function decodeSecretBytes(
  encoded: string,
): Effect.Effect<Uint8Array, DesktopConnectionCatalogStoreDecodeError> {
  return Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
    Effect.mapError((cause) => new DesktopConnectionCatalogStoreDecodeError({ cause })),
  );
}

const readDocument = (
  fileSystem: FileSystem.FileSystem,
  catalogPath: string,
): Effect.Effect<Option.Option<ConnectionCatalogDocument>> =>
  fileSystem.readFileString(catalogPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<ConnectionCatalogDocument>()),
        onSome: (raw) => decodeConnectionCatalogDocumentJson(raw).pipe(Effect.option),
      }),
    ),
  );

const writeDocument = Effect.fn("desktop.connectionCatalogStore.writeDocument")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly catalogPath: string;
  readonly document: ConnectionCatalogDocument;
  readonly suffix: string;
}): Effect.fn.Return<void, PlatformError.PlatformError | Schema.SchemaError> {
  const directory = input.path.dirname(input.catalogPath);
  const tempPath = `${input.catalogPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeConnectionCatalogDocumentJson(input.document);
  yield* input.fileSystem.makeDirectory(directory, { recursive: true });
  yield* Effect.gen(function* () {
    yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`);
    yield* input.fileSystem.rename(tempPath, input.catalogPath);
  }).pipe(
    Effect.ensuring(
      input.fileSystem.remove(tempPath, { force: true }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not remove a temporary connection catalog file.", {
            tempPath,
            error,
          }),
        ),
      ),
    ),
  );
});

export const layer = Layer.effect(
  DesktopConnectionCatalogStore,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const crypto = yield* Crypto.Crypto;
    const catalogPath = path.join(environment.stateDir, "connection-catalog.json");

    return DesktopConnectionCatalogStore.of({
      get: Effect.gen(function* () {
        const document = yield* readDocument(fileSystem, catalogPath);
        if (Option.isNone(document) || !(yield* safeStorage.isEncryptionAvailable)) {
          return Option.none<string>();
        }
        return yield* decodeSecretBytes(document.value.encryptedCatalog).pipe(
          Effect.flatMap(safeStorage.decryptString),
          Effect.map(Option.some),
          Effect.catchTags({
            DesktopConnectionCatalogStoreDecodeError: (error) =>
              Effect.logWarning("Discarding an unreadable desktop connection catalog.", {
                error,
              }).pipe(
                Effect.andThen(fileSystem.remove(catalogPath, { force: true })),
                Effect.catch(() => Effect.void),
                Effect.as(Option.none<string>()),
              ),
            ElectronSafeStorageDecryptError: (error) =>
              Effect.logWarning("Discarding an undecryptable desktop connection catalog.", {
                error,
              }).pipe(
                Effect.andThen(fileSystem.remove(catalogPath, { force: true })),
                Effect.catch(() => Effect.void),
                Effect.as(Option.none<string>()),
              ),
          }),
        );
      }).pipe(Effect.withSpan("desktop.connectionCatalogStore.get")),
      set: Effect.fn("desktop.connectionCatalogStore.set")(function* (catalog) {
        if (!(yield* safeStorage.isEncryptionAvailable)) {
          return false;
        }
        const encryptedCatalog = Encoding.encodeBase64(yield* safeStorage.encryptString(catalog));
        const suffix = (yield* crypto.randomUUIDv4.pipe(
          Effect.mapError((cause) => new DesktopConnectionCatalogStoreWriteError({ cause })),
        )).replace(/-/g, "");
        yield* writeDocument({
          fileSystem,
          path,
          catalogPath,
          document: { version: 1, encryptedCatalog },
          suffix,
        }).pipe(Effect.mapError((cause) => new DesktopConnectionCatalogStoreWriteError({ cause })));
        return true;
      }),
      clear: fileSystem.remove(catalogPath, { force: true }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not clear the desktop connection catalog.", {
            catalogPath,
            error,
          }),
        ),
        Effect.withSpan("desktop.connectionCatalogStore.clear"),
      ),
    });
  }),
);

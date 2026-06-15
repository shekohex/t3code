import { useAtomValue } from "@effect/atom-react";
import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { CommandId, EnvironmentId, IsoDateTime, MessageId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";

const THREAD_OUTBOX_SCHEMA_VERSION = 1;
const THREAD_OUTBOX_DIRECTORY = "thread-outbox";
const THREAD_OUTBOX_MAX_RETRY_DELAY_MS = 16_000;

const DraftComposerImageAttachmentSchema = Schema.Struct({
  id: Schema.String,
  previewUri: Schema.String,
  type: Schema.Literal("image"),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});

export const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literal(THREAD_OUTBOX_SCHEMA_VERSION),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  attachments: Schema.Array(DraftComposerImageAttachmentSchema),
  createdAt: IsoDateTime,
});

const decodeStoredQueuedThreadMessage = Schema.decodeUnknownSync(QueuedThreadMessageSchema);
const encodeStoredQueuedThreadMessage = Schema.encodeUnknownSync(QueuedThreadMessageSchema);

type StoredQueuedThreadMessage = typeof QueuedThreadMessageSchema.Type;

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly createdAt: string;
}

export const queuedMessagesByThreadKeyAtom = Atom.make<
  Record<string, ReadonlyArray<QueuedThreadMessage>>
>({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:queued-messages"));

let loadPromise: Promise<void> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

export function serializeThreadOutboxMutation<A>(mutation: () => Promise<A>): Promise<A> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function storedMessage(message: QueuedThreadMessage): StoredQueuedThreadMessage {
  return {
    schemaVersion: THREAD_OUTBOX_SCHEMA_VERSION,
    ...message,
  };
}

function messageFileName(messageId: MessageId): string {
  return `${encodeURIComponent(messageId)}.json`;
}

async function getOutboxDirectory() {
  const { Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, THREAD_OUTBOX_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

async function getMessageFile(messageId: MessageId) {
  const { File } = await import("expo-file-system");
  return new File(await getOutboxDirectory(), messageFileName(messageId));
}

export function groupQueuedThreadMessages(
  messages: ReadonlyArray<QueuedThreadMessage>,
): Record<string, ReadonlyArray<QueuedThreadMessage>> {
  const deduplicated = new Map<MessageId, QueuedThreadMessage>();
  for (const message of messages) {
    deduplicated.set(message.messageId, message);
  }

  const grouped: Record<string, Array<QueuedThreadMessage>> = {};
  for (const message of deduplicated.values()) {
    const threadKey = scopedThreadKey(message.environmentId, message.threadId);
    (grouped[threadKey] ??= []).push(message);
  }
  for (const queue of Object.values(grouped)) {
    queue.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return grouped;
}

export function threadOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), THREAD_OUTBOX_MAX_RETRY_DELAY_MS);
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return typeof error === "string" ? error : null;
}

export function shouldRetryThreadOutboxDelivery(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ConnectionTransientError"
  ) {
    return true;
  }
  return isTransportConnectionErrorMessage(errorMessage(error));
}

export function decodeQueuedThreadMessage(value: unknown): QueuedThreadMessage {
  const { schemaVersion: _, ...message } = decodeStoredQueuedThreadMessage(value);
  return message;
}

function flattenQueues(
  queues: Record<string, ReadonlyArray<QueuedThreadMessage>>,
): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(queues).flat();
}

async function loadPersistedMessages(): Promise<ReadonlyArray<QueuedThreadMessage>> {
  const { File } = await import("expo-file-system");
  const directory = await getOutboxDirectory();
  const messages: Array<QueuedThreadMessage> = [];

  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      messages.push(decodeQueuedThreadMessage(JSON.parse(await entry.text()) as unknown));
    } catch (error) {
      console.warn("[thread-outbox] ignored invalid persisted message", entry.name, error);
    }
  }
  return messages;
}

export function ensureThreadOutboxLoaded(): void {
  if (loadPromise !== null) {
    return;
  }
  loadPromise = loadPersistedMessages()
    .then((persistedMessages) =>
      serializeThreadOutboxMutation(async () => {
        const current = flattenQueues(appAtomRegistry.get(queuedMessagesByThreadKeyAtom));
        appAtomRegistry.set(
          queuedMessagesByThreadKeyAtom,
          groupQueuedThreadMessages([...persistedMessages, ...current]),
        );
      }),
    )
    .catch((error) => {
      loadPromise = null;
      console.warn("[thread-outbox] failed to load persisted messages", error);
    });
}

export async function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  await serializeThreadOutboxMutation(async () => {
    const encoded = encodeStoredQueuedThreadMessage(storedMessage(message));
    const file = await getMessageFile(message.messageId);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
    }
    file.write(JSON.stringify(encoded));

    const current = flattenQueues(appAtomRegistry.get(queuedMessagesByThreadKeyAtom));
    appAtomRegistry.set(
      queuedMessagesByThreadKeyAtom,
      groupQueuedThreadMessages([...current, message]),
    );
  });
}

export async function removeThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  await serializeThreadOutboxMutation(async () => {
    const file = await getMessageFile(message.messageId);
    if (file.exists) {
      file.delete();
    }

    const current = flattenQueues(appAtomRegistry.get(queuedMessagesByThreadKeyAtom));
    appAtomRegistry.set(
      queuedMessagesByThreadKeyAtom,
      groupQueuedThreadMessages(
        current.filter((candidate) => candidate.messageId !== message.messageId),
      ),
    );
  });
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId): Promise<void> {
  await serializeThreadOutboxMutation(async () => {
    const current = flattenQueues(appAtomRegistry.get(queuedMessagesByThreadKeyAtom));
    const persisted = await loadPersistedMessages().catch((error) => {
      console.warn("[thread-outbox] failed to load messages while clearing environment", error);
      return [];
    });
    const allMessages = flattenQueues(groupQueuedThreadMessages([...persisted, ...current]));
    const removed = allMessages.filter((message) => message.environmentId === environmentId);

    await Promise.all(
      removed.map(async (message) => {
        try {
          const file = await getMessageFile(message.messageId);
          if (file.exists) {
            file.delete();
          }
        } catch (error) {
          console.warn("[thread-outbox] failed to clear persisted message", error);
        }
      }),
    );

    appAtomRegistry.set(
      queuedMessagesByThreadKeyAtom,
      groupQueuedThreadMessages(
        allMessages.filter((message) => message.environmentId !== environmentId),
      ),
    );
  });
}

export function useThreadOutboxMessages() {
  return useAtomValue(queuedMessagesByThreadKeyAtom);
}

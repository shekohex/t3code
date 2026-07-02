import { TextGenerationError, type ModelSelection, type PiAgentSettings } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { buildPiEnvironment, splitPiLaunchArgs } from "../provider/piAgentRuntimeConfig.ts";
import {
  makePiRpcRuntime,
  type PiRpcRuntimeError,
  type PiRpcRuntimeOptions,
  type PiRpcRuntimeShape,
} from "../provider/piRpcRuntime.ts";
import {
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  type ThreadTitleGenerationResult,
} from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

type PiTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const PI_TEXT_GENERATION_TIMEOUT_MS = 180_000;

interface PiTextGenerationOptions {
  readonly makeRuntime?: (
    options: PiRpcRuntimeOptions,
  ) => Effect.Effect<PiRpcRuntimeShape, PiRpcRuntimeError, Scope.Scope>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function modelErrorFromEvent(event: Record<string, unknown>): string | undefined {
  if (event.type !== "message_update") return undefined;
  const assistantMessageEvent = readRecord(event, "assistantMessageEvent");
  if (!assistantMessageEvent || assistantMessageEvent.type !== "error") return undefined;
  const error = readRecord(assistantMessageEvent, "error");
  const reason = readString(assistantMessageEvent, "reason");
  return (
    readString(error ?? {}, "errorMessage") ??
    readString(error ?? {}, "message") ??
    readString(assistantMessageEvent, "errorMessage") ??
    (reason === "aborted" ? "Pi text generation was interrupted." : "Pi text generation failed.")
  );
}

function thinkingLevel(modelSelection: ModelSelection): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "thinking") ??
    getModelSelectionStringOptionValue(modelSelection, "thinkingLevel") ??
    getModelSelectionStringOptionValue(modelSelection, "effort") ??
    getModelSelectionStringOptionValue(modelSelection, "reasoningEffort")
  );
}

function buildPiTextGenerationArgs(
  settings: PiAgentSettings,
  modelSelection: ModelSelection,
): ReadonlyArray<string> {
  const args = ["--mode", "rpc", "--no-session", "--no-tools", "--model", modelSelection.model];
  const thinking = thinkingLevel(modelSelection);
  if (thinking) args.push("--thinking", thinking);
  args.push(...splitPiLaunchArgs(settings.launchArgs));
  return args;
}

function strictJsonPrompt(prompt: string, schema: unknown): string {
  return [
    prompt,
    "",
    "Return only valid JSON. Do not include markdown fences, commentary, or extra text.",
    "JSON schema:",
    JSON.stringify(schema),
  ].join("\n");
}

function extractJsonText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function toTextGenerationError(
  operation: PiTextGenerationOperation,
  detail: string,
  cause?: unknown,
): TextGenerationError {
  return new TextGenerationError({ operation, detail, ...(cause ? { cause } : {}) });
}

export const makePiTextGeneration = (
  settings: PiAgentSettings,
  environment?: NodeJS.ProcessEnv,
  options?: PiTextGenerationOptions,
): Effect.Effect<TextGenerationShape> => {
  const runPiJson = <S extends Schema.Top>(input: {
    readonly operation: PiTextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const schemaJson = toJsonSchemaObject(input.outputSchema);
      const prompt = strictJsonPrompt(input.prompt, schemaJson);
      const decoded = yield* Effect.scoped(
        Effect.gen(function* () {
          const completion = yield* Deferred.make<void, TextGenerationError>();
          const terminalModelError = yield* Ref.make<string | undefined>(undefined);
          const createRuntime = options?.makeRuntime ?? makePiRpcRuntime;
          const runtime = yield* createRuntime({
            binaryPath: settings.binaryPath,
            cwd: input.cwd,
            args: buildPiTextGenerationArgs(settings, input.modelSelection),
            env: buildPiEnvironment(settings, environment),
            extendEnv: true,
          }).pipe(
            Effect.mapError((cause) =>
              toTextGenerationError(
                input.operation,
                "Failed to start Pi RPC text generation.",
                cause,
              ),
            ),
          );

          const eventsFiber = yield* runtime.events.pipe(
            Stream.runForEach(({ event }) => {
              if (!isRecord(event)) return Effect.void;
              const modelError = modelErrorFromEvent(event);
              if (modelError !== undefined) {
                return Ref.set(terminalModelError, modelError);
              }
              if (event.type === "auto_retry_end") {
                if (event.success === true) return Ref.set(terminalModelError, undefined);
                const finalError =
                  readString(event, "finalError") ?? "Pi text generation retry failed.";
                return Ref.set(terminalModelError, finalError);
              }
              if (event.type === "agent_settled") {
                return Ref.get(terminalModelError).pipe(
                  Effect.flatMap((error) =>
                    error === undefined
                      ? Deferred.succeed(completion, undefined)
                      : Deferred.fail(completion, toTextGenerationError(input.operation, error)),
                  ),
                  Effect.ignore,
                );
              }
              if (event.type === "extension_error" || event.type === "process_error") {
                return Deferred.fail(
                  completion,
                  toTextGenerationError(
                    input.operation,
                    readString(event, "message") ??
                      readString(event, "error") ??
                      "Pi text generation failed.",
                  ),
                ).pipe(Effect.ignore);
              }
              if (event.type === "process_exit") {
                return Deferred.fail(
                  completion,
                  toTextGenerationError(
                    input.operation,
                    "Pi RPC process exited before completion.",
                  ),
                ).pipe(Effect.ignore);
              }
              return Effect.void;
            }),
            Effect.forkScoped,
          );

          yield* runtime
            .request({ type: "prompt", message: prompt })
            .pipe(
              Effect.mapError((cause) =>
                toTextGenerationError(
                  input.operation,
                  "Failed to send Pi text-generation prompt.",
                  cause,
                ),
              ),
            );
          yield* Deferred.await(completion).pipe(
            Effect.timeoutOption(PI_TEXT_GENERATION_TIMEOUT_MS),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    toTextGenerationError(input.operation, "Pi text generation timed out."),
                  ),
                onSome: () => Effect.void,
              }),
            ),
          );
          yield* Fiber.interrupt(eventsFiber).pipe(Effect.ignore);

          const lastMessage = yield* runtime
            .request<{ text: string | null }>({
              type: "get_last_assistant_text",
            })
            .pipe(
              Effect.mapError((cause) =>
                toTextGenerationError(input.operation, "Failed to read Pi generated text.", cause),
              ),
            );
          const text = lastMessage.text?.trim();
          if (!text) {
            return yield* toTextGenerationError(
              input.operation,
              "Pi returned empty generated text.",
            );
          }

          return extractJsonText(text);
        }),
      );

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchema));
      return yield* decodeOutput(decoded).pipe(
        Effect.mapError((cause) =>
          toTextGenerationError(input.operation, "Pi returned invalid structured output.", cause),
        ),
      );
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "PiTextGeneration.generateCommitMessage",
  )(function* (input): Effect.fn.Return<CommitMessageGenerationResult, TextGenerationError> {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runPiJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "PiTextGeneration.generatePrContent",
  )(function* (input): Effect.fn.Return<PrContentGenerationResult, TextGenerationError> {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runPiJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "PiTextGeneration.generateBranchName",
  )(function* (input): Effect.fn.Return<BranchNameGenerationResult, TextGenerationError> {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runPiJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });

    return { branch: sanitizeBranchFragment(generated.branch) };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "PiTextGeneration.generateThreadTitle",
  )(function* (input): Effect.fn.Return<ThreadTitleGenerationResult, TextGenerationError> {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runPiJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });

    return { title: sanitizeThreadTitle(generated.title) } satisfies ThreadTitleGenerationResult;
  });

  return Effect.succeed({
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  });
};

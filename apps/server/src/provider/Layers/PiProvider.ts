import type {
  PiAgentSettings,
  ServerProviderModel,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  detailFromResult,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { buildPiEnvironment, splitPiLaunchArgs } from "../piAgentRuntimeConfig.ts";
import { makePiRpcRuntime } from "../piRpcRuntime.ts";

const DRIVER_KIND = ProviderDriverKind.make("piAgent");

const PI_PRESENTATION = {
  displayName: "Pi Agent",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  supportedRuntimeModes: ["full-access"],
  requiresNewThreadForModelChange: false,
} as const;

const PI_THINKING_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium", isDefault: true },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
] as const;

const EMPTY_PI_MODEL_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const PI_MODEL_PROBE_TIMEOUT = Duration.seconds(15);
const MINIMUM_PI_VERSION = "0.80.6";

class PiProviderLaunchArgsError extends Data.TaggedError("PiProviderLaunchArgsError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

interface PiProviderCapabilities {
  readonly modelsResponse: unknown;
  readonly commandsResponse: unknown;
}

interface PiProviderCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

const DEFAULT_PI_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "codex-openai/gpt-5.5",
    name: "GPT-5.5 (Codex OpenAI)",
    isCustom: false,
    capabilities: EMPTY_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "codex-openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini (Codex OpenAI)",
    isCustom: false,
    capabilities: EMPTY_PI_MODEL_CAPABILITIES,
  },
];

export const piModelsFromSettings = (
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(
    DEFAULT_PI_MODELS,
    DRIVER_KIND,
    customModels,
    EMPTY_PI_MODEL_CAPABILITIES,
  );

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function piModelCapabilities(model: Record<string, unknown>) {
  if (model.reasoning !== true) return EMPTY_PI_MODEL_CAPABILITIES;

  const thinkingLevelMap = readRecord(model, "thinkingLevelMap");
  const options = PI_THINKING_OPTIONS.filter(({ id }) => {
    const mappedLevel = thinkingLevelMap?.[id];
    if (mappedLevel === null) return false;
    return id !== "xhigh" && id !== "max" ? true : typeof mappedLevel === "string";
  });

  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "thinking",
        label: "Thinking",
        type: "select",
        options,
        ...(options.some((option) => option.id === "medium") ? { currentValue: "medium" } : {}),
      },
    ],
  });
}

function piModelRowsFromRpc(value: unknown): ReadonlyArray<ServerProviderModel> {
  if (!isRecord(value) || !Array.isArray(value.models)) return [];
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];

  for (const model of value.models) {
    if (!isRecord(model)) continue;
    const provider = readString(model, "provider");
    const id = readString(model, "id");
    if (!provider || !id) continue;
    const slug = `${provider}/${id}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const name = readString(model, "name") ?? id;
    models.push({
      slug,
      name: `${name} (${provider})`,
      isCustom: false,
      capabilities: piModelCapabilities(model),
    });
  }

  return models;
}

const probePiCapabilities = (
  settings: PiAgentSettings,
  env: NodeJS.ProcessEnv,
  launchArgs: ReadonlyArray<string>,
) =>
  Effect.scoped(
    makePiRpcRuntime({
      binaryPath: settings.binaryPath,
      cwd: process.cwd(),
      args: ["--mode", "rpc", "--no-session", "--no-tools", ...launchArgs],
      env,
      extendEnv: true,
    }).pipe(
      Effect.flatMap((runtime) =>
        Effect.gen(function* () {
          const modelsResponse = yield* runtime.request({ type: "get_available_models" });
          const commandsResponse = yield* runtime
            .request({ type: "get_commands" })
            .pipe(Effect.orElseSucceed(() => ({ commands: [] })));
          return { modelsResponse, commandsResponse } satisfies PiProviderCapabilities;
        }),
      ),
    ),
  );

function mergeDiscoveredPiModels(
  discoveredModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    discoveredModels.length > 0 ? discoveredModels : DEFAULT_PI_MODELS,
    DRIVER_KIND,
    customModels,
    EMPTY_PI_MODEL_CAPABILITIES,
  );
}

function dedupeSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const byName = new Map<string, ServerProviderSlashCommand>();
  for (const command of commands) {
    const key = command.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, command);
      continue;
    }
    byName.set(key, {
      ...existing,
      ...(existing.description || !command.description ? {} : { description: command.description }),
      ...(existing.input?.hint || !command.input?.hint
        ? {}
        : { input: { hint: command.input.hint } }),
    });
  }
  return [...byName.values()];
}

function dedupeSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const byName = new Map<string, ServerProviderSkill>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, skill);
      continue;
    }
    byName.set(key, {
      ...existing,
      ...(existing.description || !skill.description ? {} : { description: skill.description }),
      ...(existing.shortDescription || !skill.shortDescription
        ? {}
        : { shortDescription: skill.shortDescription }),
      ...(existing.displayName || !skill.displayName ? {} : { displayName: skill.displayName }),
    });
  }
  return [...byName.values()];
}

function piCommandRowsFromRpc(value: unknown): PiProviderCommands {
  if (!isRecord(value) || !Array.isArray(value.commands)) {
    return { slashCommands: [], skills: [] };
  }

  const slashCommands: ServerProviderSlashCommand[] = [];
  const skills: ServerProviderSkill[] = [];

  for (const command of value.commands) {
    if (!isRecord(command)) continue;
    const name = readString(command, "name");
    if (!name) continue;
    const description = readString(command, "description");
    slashCommands.push({
      name,
      ...(description ? { description } : {}),
    });

    if (readString(command, "source") !== "skill" || !name.startsWith("skill:")) continue;
    const sourceInfo = readRecord(command, "sourceInfo");
    const path = sourceInfo ? readString(sourceInfo, "path") : undefined;
    if (!path) continue;
    const skillName = name.slice("skill:".length).trim();
    if (!skillName) continue;
    const scope = sourceInfo ? readString(sourceInfo, "scope") : undefined;
    skills.push({
      name: skillName,
      path,
      enabled: true,
      ...(scope ? { scope } : {}),
      ...(description ? { description, shortDescription: description } : {}),
    });
  }

  return {
    slashCommands: dedupeSlashCommands(slashCommands),
    skills: dedupeSkills(skills),
  };
}

export const makePendingPiProvider = (
  settings: PiAgentSettings,
): Effect.Effect<ServerProviderDraft> =>
  DateTime.now.pipe(
    Effect.map((checkedAt) =>
      buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: settings.enabled,
        checkedAt: DateTime.formatIso(checkedAt),
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: settings.enabled,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: settings.enabled
            ? "Checking Pi Agent..."
            : "Pi Agent is disabled in T3 Code settings.",
        },
      }),
    ),
  );

export const checkPiProviderStatus = (
  settings: PiAgentSettings,
  env?: NodeJS.ProcessEnv | undefined,
): Effect.Effect<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (!settings.enabled) {
      return buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi Agent is disabled in T3 Code settings.",
        },
      });
    }

    const probeEnv = buildPiEnvironment(settings, env);
    const result = yield* spawnAndCollect(
      settings.binaryPath,
      ChildProcess.make(settings.binaryPath, ["--version"], {
        env: probeEnv,
        extendEnv: true,
        forceKillAfter: "2 seconds",
      }),
    ).pipe(Effect.result);

    if (result._tag === "Failure") {
      return buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: settings.enabled,
        checkedAt,
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: result.failure.message,
        },
      });
    }

    const detail = detailFromResult(result.success);
    const version = parseGenericCliVersion(`${result.success.stdout}\n${result.success.stderr}`);
    if (result.success.code !== 0) {
      return buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: settings.enabled,
        checkedAt,
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: false,
          version,
          status: "error",
          auth: { status: "unknown" },
          ...(detail ? { message: detail } : {}),
        },
      });
    }

    if (!version || compareSemverVersions(version, MINIMUM_PI_VERSION) < 0) {
      return buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: settings.enabled,
        checkedAt,
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: version
            ? `Pi Agent ${version} is unsupported. T3 Code requires ${MINIMUM_PI_VERSION} or newer.`
            : `Unable to determine Pi Agent version. T3 Code requires ${MINIMUM_PI_VERSION} or newer.`,
        },
      });
    }

    const launchArgsResult = yield* Effect.try({
      try: () => splitPiLaunchArgs(settings.launchArgs),
      catch: (cause) =>
        new PiProviderLaunchArgsError({
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(Effect.result);
    if (launchArgsResult._tag === "Failure") {
      return buildServerProvider({
        driver: DRIVER_KIND,
        presentation: PI_PRESENTATION,
        enabled: settings.enabled,
        checkedAt,
        models: piModelsFromSettings(settings.customModels),
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: launchArgsResult.failure.detail,
        },
      });
    }

    const capabilitiesProbe = yield* probePiCapabilities(
      settings,
      probeEnv,
      launchArgsResult.success,
    ).pipe(Effect.timeoutOption(PI_MODEL_PROBE_TIMEOUT), Effect.result);

    const discoveredModels =
      capabilitiesProbe._tag === "Success" && Option.isSome(capabilitiesProbe.success)
        ? piModelRowsFromRpc(capabilitiesProbe.success.value.modelsResponse)
        : [];
    const commands =
      capabilitiesProbe._tag === "Success" && Option.isSome(capabilitiesProbe.success)
        ? piCommandRowsFromRpc(capabilitiesProbe.success.value.commandsResponse)
        : { slashCommands: [], skills: [] };
    const models = mergeDiscoveredPiModels(discoveredModels, settings.customModels);
    const modelProbeMessage =
      capabilitiesProbe._tag === "Success"
        ? Option.isNone(capabilitiesProbe.success)
          ? "Timed out while discovering Pi models."
          : undefined
        : capabilitiesProbe.failure instanceof Error
          ? capabilitiesProbe.failure.message
          : String(capabilitiesProbe.failure);
    const probeMessage = modelProbeMessage ?? detail;

    return buildServerProvider({
      driver: DRIVER_KIND,
      presentation: PI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models,
      slashCommands: commands.slashCommands,
      skills: commands.skills,
      probe: {
        installed: true,
        version,
        status: modelProbeMessage ? "warning" : "ready",
        auth: { status: discoveredModels.length > 0 ? "authenticated" : "unknown" },
        ...(probeMessage ? { message: probeMessage } : {}),
      },
    });
  });

export const __PiProviderTestKit = {
  isSupportedVersion: (version: string) => compareSemverVersions(version, MINIMUM_PI_VERSION) >= 0,
  piCommandRowsFromRpc,
  piModelRowsFromRpc,
};

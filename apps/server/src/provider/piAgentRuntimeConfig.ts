import type { PiAgentSettings } from "@t3tools/contracts";

import { expandHomePath } from "../pathExpansion.ts";

const T3_MANAGED_PI_LAUNCH_FLAGS = new Set([
  "--api-key",
  "--append-system-prompt",
  "--approve",
  "--continue",
  "--exclude-tool",
  "--exclude-tools",
  "--export",
  "--fork",
  "--help",
  "--list-models",
  "--mode",
  "--model",
  "--models",
  "--name",
  "--no-approve",
  "--no-builtin-tools",
  "--no-session",
  "--no-trust",
  "--no-tool",
  "--no-tools",
  "--print",
  "--prompt",
  "--provider",
  "--resume",
  "--resume-session",
  "--session",
  "--session-dir",
  "--session-file",
  "--session-id",
  "--system-prompt",
  "--thinking",
  "--tool",
  "--tools",
  "--trust",
  "--version",
  "-a",
  "-c",
  "-h",
  "-n",
  "-na",
  "-nbt",
  "-nt",
  "-p",
  "-r",
  "-t",
  "-v",
  "-xt",
]);

const PI_SAFE_VALUE_FLAGS = new Set([
  "--extension",
  "--prompt-template",
  "--skill",
  "--theme",
  "-e",
]);

const PI_SAFE_BOOLEAN_FLAGS = new Set([
  "--no-context-files",
  "--no-extensions",
  "--no-prompt-templates",
  "--no-skills",
  "--no-themes",
  "--offline",
  "--verbose",
  "-nc",
  "-ne",
  "-np",
  "-ns",
]);

function piLaunchFlagName(argument: string): string | undefined {
  if (!argument.startsWith("-")) return undefined;
  const equalsIndex = argument.indexOf("=");
  return argument.slice(0, equalsIndex === -1 ? argument.length : equalsIndex).toLowerCase();
}

function parseShellStyleArgv(value: string): Array<string> {
  const argumentsList: string[] = [];
  let argument = "";
  let quote: "'" | '"' | undefined;
  let argumentStarted = false;

  const pushArgument = () => {
    if (!argumentStarted) return;
    argumentsList.push(argument);
    argument = "";
    argumentStarted = false;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if (quote === "'") {
      if (character === "'") quote = undefined;
      else argument += character;
      argumentStarted = true;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
        continue;
      }
      if (character === "\\") {
        const nextCharacter = value[index + 1];
        if (nextCharacter === undefined) {
          throw new Error("Invalid Pi launch arguments: trailing escape.");
        }
        if (nextCharacter === "\n") {
          index += 1;
          continue;
        }
        if (
          nextCharacter === '"' ||
          nextCharacter === "\\" ||
          nextCharacter === "$" ||
          nextCharacter === "`"
        ) {
          argument += nextCharacter;
          argumentStarted = true;
          index += 1;
          continue;
        }
        argument += "\\";
        argumentStarted = true;
        continue;
      }
      argument += character;
      argumentStarted = true;
      continue;
    }

    if (/\s/u.test(character)) {
      pushArgument();
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      argumentStarted = true;
      continue;
    }
    if (character === "\\") {
      const nextCharacter = value[index + 1];
      if (nextCharacter === undefined) {
        throw new Error("Invalid Pi launch arguments: trailing escape.");
      }
      if (nextCharacter === "\n") {
        index += 1;
        continue;
      }
      argument += nextCharacter;
      argumentStarted = true;
      index += 1;
      continue;
    }
    argument += character;
    argumentStarted = true;
  }

  if (quote !== undefined) {
    throw new Error("Invalid Pi launch arguments: unterminated quote.");
  }
  pushArgument();
  return argumentsList;
}

export function validatePiLaunchArgs(argumentsList: ReadonlyArray<string>): void {
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    const flagName = piLaunchFlagName(argument);
    if (!flagName) {
      throw new Error(`Pi launch argument '${argument}' must follow an extension flag.`);
    }
    if (!flagName.startsWith("--mode-") && T3_MANAGED_PI_LAUNCH_FLAGS.has(flagName)) {
      throw new Error(`Pi launch flag '${flagName}' is managed by T3 Code.`);
    }
    if (
      flagName.startsWith("-") &&
      !flagName.startsWith("--") &&
      !PI_SAFE_VALUE_FLAGS.has(flagName) &&
      !PI_SAFE_BOOLEAN_FLAGS.has(flagName)
    ) {
      throw new Error(`Pi launch flag '${flagName}' is not supported by T3 Code.`);
    }
    if (argument.includes("=")) continue;

    const nextArgument = argumentsList[index + 1];
    const acceptsValue =
      PI_SAFE_VALUE_FLAGS.has(flagName) ||
      (flagName.startsWith("--") &&
        !flagName.startsWith("--mode-") &&
        !PI_SAFE_BOOLEAN_FLAGS.has(flagName));
    if (
      acceptsValue &&
      nextArgument !== undefined &&
      !nextArgument.startsWith("-") &&
      !nextArgument.startsWith("@")
    ) {
      index += 1;
    }
  }
}

export function splitPiLaunchArgs(value: string): ReadonlyArray<string> {
  const argumentsList = parseShellStyleArgv(value);
  validatePiLaunchArgs(argumentsList);
  return argumentsList;
}

export function buildPiEnvironment(
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...(settings.agentDir ? { PI_CODING_AGENT_DIR: expandHomePath(settings.agentDir) } : {}),
  };
}

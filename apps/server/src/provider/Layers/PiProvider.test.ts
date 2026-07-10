import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PiAgentSettings } from "@t3tools/contracts";

import { __PiProviderTestKit, makePendingPiProvider } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiAgentSettings);

it("maps Pi RPC commands and skills into provider snapshot rows", () => {
  const parsed = __PiProviderTestKit.piCommandRowsFromRpc({
    commands: [
      {
        name: "review",
        description: "Review code changes",
        source: "extension",
        sourceInfo: { path: "<review>", scope: "temporary" },
      },
      {
        name: "skill:creating-issues",
        description: "Create GitHub issues",
        source: "skill",
        sourceInfo: {
          path: "/home/test/.pi/agent/skills/creating-issues/SKILL.md",
          scope: "user",
        },
      },
    ],
  });

  NodeAssert.deepEqual(parsed.slashCommands, [
    { name: "review", description: "Review code changes" },
    { name: "skill:creating-issues", description: "Create GitHub issues" },
  ]);
  NodeAssert.deepEqual(parsed.skills, [
    {
      name: "creating-issues",
      path: "/home/test/.pi/agent/skills/creating-issues/SKILL.md",
      enabled: true,
      scope: "user",
      description: "Create GitHub issues",
      shortDescription: "Create GitHub issues",
    },
  ]);
});

it.effect("presents Pi model changes in session and hides unsupported interaction mode", () =>
  Effect.gen(function* () {
    const snapshot = yield* makePendingPiProvider(decodePiSettings({}));

    NodeAssert.equal(snapshot.showInteractionModeToggle, false);
    NodeAssert.deepEqual(snapshot.supportedRuntimeModes, ["full-access"]);
    NodeAssert.equal(snapshot.requiresNewThreadForModelChange, false);
    NodeAssert.deepEqual(snapshot.models[0]?.capabilities?.optionDescriptors, []);
  }),
);

it("derives Pi thinking options from public model metadata", () => {
  const models = __PiProviderTestKit.piModelRowsFromRpc({
    models: [
      {
        provider: "example",
        id: "reasoning-model",
        name: "Reasoning Model",
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          xhigh: null,
          max: "max",
        },
      },
      {
        provider: "example",
        id: "non-reasoning-model",
        name: "Non-reasoning Model",
        reasoning: false,
      },
    ],
  });

  const reasoningDescriptor = models[0]?.capabilities?.optionDescriptors?.find(
    (descriptor) => descriptor.id === "thinking" && descriptor.type === "select",
  );
  NodeAssert.ok(reasoningDescriptor && reasoningDescriptor.type === "select");
  NodeAssert.deepEqual(
    reasoningDescriptor.options.map((option) => option.id),
    ["low", "medium", "high", "max"],
  );
  NodeAssert.deepEqual(models[1]?.capabilities?.optionDescriptors, []);
});

it("rejects Pi versions older than the tested RPC protocol", () => {
  NodeAssert.equal(__PiProviderTestKit.isSupportedVersion("0.80.5"), false);
  NodeAssert.equal(__PiProviderTestKit.isSupportedVersion("0.80.6"), true);
  NodeAssert.equal(__PiProviderTestKit.isSupportedVersion("0.81.0"), true);
});

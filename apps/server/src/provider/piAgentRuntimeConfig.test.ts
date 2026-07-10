import { describe, expect, it } from "vite-plus/test";

import { splitPiLaunchArgs, validatePiLaunchArgs } from "./piAgentRuntimeConfig.ts";

describe("splitPiLaunchArgs", () => {
  it("parses quoted values as one argv entry", () => {
    expect(
      splitPiLaunchArgs(`--extension "./extensions/team helper.ts" --skill './skills/team skill'`),
    ).toEqual(["--extension", "./extensions/team helper.ts", "--skill", "./skills/team skill"]);
  });

  it("parses escaped whitespace and quotes", () => {
    expect(
      splitPiLaunchArgs(
        String.raw`--extension ./extensions/team\ helper.ts --wrapper-label="say \"hello\""`,
      ),
    ).toEqual(["--extension", "./extensions/team helper.ts", '--wrapper-label=say "hello"']);
  });

  it("rejects malformed shell-style argv", () => {
    expect(() => splitPiLaunchArgs(`--extension "./unterminated`)).toThrow(/unterminated quote/i);
    expect(() => splitPiLaunchArgs("--extension ./trailing\\")).toThrow(/trailing escape/i);
  });

  it("rejects T3-managed flags, including equals syntax", () => {
    for (const argument of [
      "--mode=rpc",
      "--session=existing-session",
      "--resume=existing-session",
      "--model=provider/model",
      "--provider=provider",
      "--thinking=high",
      "--approve",
      "--no-approve",
      "--no-tools",
      "--tools=read,bash",
      "--exclude-tools=write",
      "--print",
      "--export=session.html",
      "--api-key=secret",
      "--system-prompt=override",
      "--append-system-prompt=override",
    ]) {
      expect(() => splitPiLaunchArgs(argument)).toThrow(/managed by T3 Code/i);
    }
  });

  it("rejects short aliases for T3-managed flags", () => {
    for (const argument of [
      "-p",
      "-c",
      "-r",
      "-a",
      "-na",
      "-nt",
      "-nbt",
      "-t=read",
      "-xt=write",
      "-h",
      "-v",
    ]) {
      expect(() => validatePiLaunchArgs([argument])).toThrow(/managed by T3 Code/i);
    }
  });

  it("rejects positional prompts and unsupported short flags", () => {
    expect(() => splitPiLaunchArgs("run this prompt")).toThrow(/must follow an extension flag/i);
    expect(() => splitPiLaunchArgs("--offline run this prompt")).toThrow(
      /must follow an extension flag/i,
    );
    expect(() => splitPiLaunchArgs("-x value")).toThrow(/not supported by T3 Code/i);
    expect(splitPiLaunchArgs('--wrapper-label "value with spaces"')).toEqual([
      "--wrapper-label",
      "value with spaces",
    ]);
  });

  it("allows extension and resource flags, including mode extensions", () => {
    expect(
      splitPiLaunchArgs(
        String.raw`--extension "./extensions/team helper.ts" --skill ./skills/team --prompt-template ./templates/review.md --theme ./themes/dark.json --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --mode-review --wrapper-flag="value with spaces"`,
      ),
    ).toEqual([
      "--extension",
      "./extensions/team helper.ts",
      "--skill",
      "./skills/team",
      "--prompt-template",
      "./templates/review.md",
      "--theme",
      "./themes/dark.json",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--mode-review",
      "--wrapper-flag=value with spaces",
    ]);
  });
});

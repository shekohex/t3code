import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownLinkPresentation } from "@t3tools/mobile-markdown-text/links";

describe("resolveMarkdownLinkPresentation", () => {
  it("extracts external link hosts", () => {
    expect(resolveMarkdownLinkPresentation("https://example.com/docs?q=1")).toEqual({
      kind: "external",
      href: "https://example.com/docs?q=1",
      host: "example.com",
    });
  });

  it("renders file URLs as basename pills with positions", () => {
    expect(
      resolveMarkdownLinkPresentation("file:///Users/julius/project/src/main.ts#L42C7"),
    ).toEqual({
      kind: "file",
      icon: "typescript",
      label: "main.ts:42:7",
    });
  });

  it("recognizes relative source paths and bare filenames", () => {
    expect(resolveMarkdownLinkPresentation("apps/mobile/src/index.ts:10")).toEqual({
      kind: "file",
      icon: "typescript",
      label: "index.ts:10",
    });
    expect(resolveMarkdownLinkPresentation("AGENTS.md")).toEqual({
      kind: "file",
      icon: "agents",
      label: "AGENTS.md",
    });
    expect(resolveMarkdownLinkPresentation("package.json")).toEqual({
      kind: "file",
      icon: "npm",
      label: "package.json",
    });
  });

  it("does not style app routes as file links", () => {
    expect(resolveMarkdownLinkPresentation("/chat/settings")).toEqual({
      kind: "link",
      href: null,
    });
  });
});

import { Linking, type TextStyle } from "react-native";
import { UITextView } from "react-native-uitextview";

import type { NativeMarkdownTextRun } from "../lib/nativeMarkdownText";
import type { NativeMarkdownTextStyle } from "./SelectableMarkdownText.types";

const EXTERNAL_LINK_PREFIX = "◉ ";
const FILE_LINK_PREFIX = "▧ ";

function runKeySignature(run: NativeMarkdownTextRun): string {
  return [
    run.text,
    run.bold,
    run.italic,
    run.strikethrough,
    run.code,
    run.href,
    run.externalHost,
    run.fileIcon,
    run.role,
    run.headingLevel,
    run.depth,
    run.spacing,
  ].join(":");
}

function runStyle(run: NativeMarkdownTextRun, textStyle: NativeMarkdownTextStyle): TextStyle {
  const isFile = run.fileIcon != null;
  const headingLevel = Math.max(1, Math.min(6, run.headingLevel ?? 1));
  const headingFontSize = [22, 19, 17, 16, 15, 15][headingLevel - 1] ?? 15;
  const isHeading = run.role === "heading";
  const isCodeBlock = run.role === "code-block" || run.role === "code-language";
  const textDecorationLine = run.strikethrough ? "line-through" : run.href ? "underline" : "none";

  return {
    color: run.href
      ? textStyle.linkColor
      : isHeading
        ? textStyle.strongColor
        : run.role === "quote-marker"
          ? textStyle.quoteMarkerColor
          : run.role === "divider"
            ? textStyle.dividerColor
            : run.role === "code-language"
              ? textStyle.mutedColor
              : run.role === "list-marker"
                ? textStyle.mutedColor
                : run.code || isFile
                  ? textStyle.codeColor
                  : run.bold
                    ? textStyle.strongColor
                    : textStyle.color,
    fontFamily:
      run.code || isCodeBlock
        ? "ui-monospace"
        : isHeading
          ? textStyle.headingFontFamily
          : run.bold
            ? textStyle.boldFontFamily
            : textStyle.fontFamily,
    fontSize:
      run.role === "spacer"
        ? (run.spacing ?? 10)
        : run.role === "list-break"
          ? textStyle.fontSize
          : isHeading
            ? headingFontSize
            : run.role === "code-language"
              ? 11
              : run.code || isFile || isCodeBlock
                ? Math.max(12, textStyle.fontSize - 2)
                : textStyle.fontSize,
    lineHeight:
      run.role === "spacer"
        ? (run.spacing ?? 10)
        : run.role === "list-break"
          ? textStyle.lineHeight + (run.spacing ?? 0)
          : isHeading
            ? Math.max(headingFontSize + 6, 20)
            : isCodeBlock
              ? 18
              : textStyle.lineHeight,
    fontStyle: run.italic ? "italic" : "normal",
    fontWeight: isHeading || run.bold ? "700" : "400",
    textDecorationLine,
    backgroundColor: isCodeBlock
      ? textStyle.codeBlockBackgroundColor
      : run.code
        ? textStyle.codeBackgroundColor
        : isFile
          ? textStyle.fileBackgroundColor
          : undefined,
  };
}

export function NativeMarkdownSelectableText(props: {
  readonly runs: ReadonlyArray<NativeMarkdownTextRun>;
  readonly textStyle: NativeMarkdownTextStyle;
}) {
  const occurrences = new Map<string, number>();
  const prefixedExternalLinks = new Set<string>();
  const keyedRuns = props.runs.map((run) => {
    const signature = runKeySignature(run);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);

    let text = run.text;
    if (run.fileIcon) {
      text = `${FILE_LINK_PREFIX}${text}`;
    } else if (run.externalHost && run.href && !prefixedExternalLinks.has(run.href)) {
      prefixedExternalLinks.add(run.href);
      text = `${EXTERNAL_LINK_PREFIX}${text}`;
    }

    return { key: `${signature}:${occurrence}`, run, text };
  });

  return (
    <UITextView
      uiTextView
      selectable
      style={{
        width: "100%",
        color: props.textStyle.color,
        fontFamily: props.textStyle.fontFamily,
        fontSize: props.textStyle.fontSize,
        lineHeight: props.textStyle.lineHeight,
      }}
    >
      {keyedRuns.map(({ key, run, text }) => {
        const href = run.href;
        return (
          <UITextView
            key={key}
            style={runStyle(run, props.textStyle)}
            onPress={
              href
                ? () => {
                    void Linking.openURL(href);
                  }
                : undefined
            }
          >
            {text}
          </UITextView>
        );
      })}
    </UITextView>
  );
}

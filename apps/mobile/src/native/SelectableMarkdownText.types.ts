export interface NativeMarkdownTextStyle {
  readonly color: string;
  readonly strongColor: string;
  readonly mutedColor: string;
  readonly linkColor: string;
  readonly codeColor: string;
  readonly codeBackgroundColor: string;
  readonly codeBlockBackgroundColor: string;
  readonly fileBackgroundColor: string;
  readonly quoteMarkerColor: string;
  readonly dividerColor: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily: string;
  readonly headingFontFamily: string;
  readonly boldFontFamily: string;
}

export interface SelectableMarkdownTextProps {
  readonly markdown: string;
  readonly textStyle: NativeMarkdownTextStyle;
  readonly marginTop?: number;
  readonly marginBottom?: number;
}

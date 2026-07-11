import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";

import type {
  NativeReviewDiffRow,
  NativeReviewDiffStyle,
  NativeReviewDiffTheme,
  NativeReviewDiffToken,
  NativeReviewDiffViewProps,
} from "./nativeReviewDiffSurface";

const DEFAULT_STYLE: Required<
  Pick<NativeReviewDiffStyle, "changeBarWidth" | "codePadding" | "gutterWidth">
> = {
  changeBarWidth: 4,
  codePadding: 8,
  gutterWidth: 44,
};

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nativeEvent<T>(payload: T): NativeSyntheticEvent<T> {
  return { nativeEvent: payload } as NativeSyntheticEvent<T>;
}

function TokenizedCode(props: {
  readonly content: string;
  readonly tokens: ReadonlyArray<NativeReviewDiffToken> | undefined;
  readonly wordDiffRanges: NativeReviewDiffRow["wordDiffRanges"];
  readonly wordDiffColor: string | undefined;
  readonly color: string;
  readonly fontSize: number;
}) {
  const tokens = props.tokens?.length
    ? props.tokens
    : [{ content: props.content, color: props.color, fontStyle: null }];
  let contentOffset = 0;
  return tokens.flatMap((token) => {
    const tokenStart = contentOffset;
    const tokenEnd = tokenStart + token.content.length;
    contentOffset = tokenEnd;
    const boundaries = new Set([tokenStart, tokenEnd]);
    for (const range of props.wordDiffRanges ?? []) {
      if (range.end > tokenStart && range.start < tokenEnd) {
        boundaries.add(Math.max(tokenStart, range.start));
        boundaries.add(Math.min(tokenEnd, range.end));
      }
    }
    const offsets = [...boundaries].sort((left, right) => left - right);
    return offsets.slice(0, -1).map((start, index) => {
      const end = offsets[index + 1] ?? start;
      const highlighted = props.wordDiffRanges?.some(
        (range) => start >= range.start && end <= range.end,
      );
      return (
        <Text
          key={`${start}:${end}:${token.color ?? ""}:${token.fontStyle ?? ""}`}
          style={{
            backgroundColor: highlighted ? props.wordDiffColor : undefined,
            color: token.color ?? props.color,
            fontSize: props.fontSize,
            fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : "normal",
            fontWeight: token.fontStyle && token.fontStyle & 2 ? "700" : "400",
          }}
        >
          {token.content.slice(start - tokenStart, end - tokenStart)}
        </Text>
      );
    });
  });
}

export const ReviewDiffFallbackSurface = memo(function ReviewDiffFallbackSurface(
  props: NativeReviewDiffViewProps,
) {
  const listRef = useRef<FlatList<NativeReviewDiffRow>>(null);
  const rows = useMemo(
    () => parseJson<ReadonlyArray<NativeReviewDiffRow>>(props.rowsJson, []),
    [props.rowsJson],
  );
  const theme = useMemo(
    () =>
      parseJson<NativeReviewDiffTheme>(props.themeJson, {
        background: props.appearanceScheme === "dark" ? "#0e0e0e" : "#f2f2f7",
        text: props.appearanceScheme === "dark" ? "#ffffff" : "#000000",
        mutedText: "#777777",
        headerBackground: "transparent",
        border: "#555555",
        hunkBackground: "#e0f2ff",
        hunkText: "#0077aa",
        addBackground: "#e5f8f5",
        deleteBackground: "#ffe6e7",
        addBar: "#00a98f",
        deleteBar: "#d52c36",
        addText: "#199f43",
        deleteText: "#d52c36",
      }),
    [props.appearanceScheme, props.themeJson],
  );
  const surfaceStyle = useMemo(
    () => ({ ...DEFAULT_STYLE, ...parseJson<NativeReviewDiffStyle>(props.styleJson, {}) }),
    [props.styleJson],
  );
  const collapsedFiles = useMemo(
    () => new Set(parseJson<string[]>(props.collapsedFileIdsJson, [])),
    [props.collapsedFileIdsJson],
  );
  const viewedFiles = useMemo(
    () => new Set(parseJson<string[]>(props.viewedFileIdsJson, [])),
    [props.viewedFileIdsJson],
  );
  const selectedRows = useMemo(
    () => new Set(parseJson<string[]>(props.selectedRowIdsJson, [])),
    [props.selectedRowIdsJson],
  );
  const collapsedComments = useMemo(
    () => new Set(parseJson<string[]>(props.collapsedCommentIdsJson, [])),
    [props.collapsedCommentIdsJson],
  );
  const tokenCacheRef = useRef<{
    resetKey: string | undefined;
    tokensJson: string | undefined;
    tokens: Record<string, ReadonlyArray<NativeReviewDiffToken>>;
  }>({ resetKey: undefined, tokensJson: undefined, tokens: {} });
  const tokens = useMemo(() => {
    const base = parseJson<Record<string, ReadonlyArray<NativeReviewDiffToken>>>(
      props.tokensJson,
      {},
    );
    const patch = parseJson<{
      tokensByRowId?: Record<string, ReadonlyArray<NativeReviewDiffToken>>;
    }>(props.tokensPatchJson, {});
    if (
      tokenCacheRef.current.resetKey !== props.tokensResetKey ||
      tokenCacheRef.current.tokensJson !== props.tokensJson
    ) {
      tokenCacheRef.current = {
        resetKey: props.tokensResetKey,
        tokensJson: props.tokensJson,
        tokens: base,
      };
    }
    tokenCacheRef.current.tokens = {
      ...tokenCacheRef.current.tokens,
      ...patch.tokensByRowId,
    };
    return tokenCacheRef.current.tokens;
  }, [props.tokensJson, props.tokensPatchJson, props.tokensResetKey]);
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => row.kind === "file" || !row.fileId || !collapsedFiles.has(row.fileId)),
    [collapsedFiles, rows],
  );
  const fileIndexes = useMemo(
    () =>
      new Map(
        visibleRows.flatMap((row, index) =>
          row.kind === "file" && row.fileId ? [[row.fileId, index] as const] : [],
        ),
      ),
    [visibleRows],
  );

  useImperativeHandle(
    props.nativeViewRef,
    () => ({
      scrollToFile: async (fileId, animated = true) => {
        const index = fileIndexes.get(fileId);
        if (index !== undefined)
          listRef.current?.scrollToIndex({ index, animated, viewPosition: 0 });
      },
      scrollToTop: async (animated = true) =>
        listRef.current?.scrollToOffset({ offset: 0, animated }),
    }),
    [fileIndexes],
  );

  useEffect(() => {
    if ((props.initialRowIndex ?? -1) < 0 || visibleRows.length === 0) return;
    const frame = requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({
        index: Math.min(props.initialRowIndex ?? 0, visibleRows.length - 1),
        animated: false,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [props.contentResetKey, props.initialRowIndex, visibleRows.length]);

  const emitLine = useCallback(
    (row: NativeReviewDiffRow, gesture: "tap" | "longPress") => {
      props.onPressLine?.(
        nativeEvent({
          rowId: row.id,
          fileId: row.fileId,
          gesture,
          oldLineNumber: row.oldLineNumber ?? undefined,
          newLineNumber: row.newLineNumber ?? undefined,
          change: row.change,
        }),
      );
    },
    [props.onPressLine],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: NativeReviewDiffRow }) => {
      if (row.kind === "file") {
        const collapsed = !!row.fileId && collapsedFiles.has(row.fileId);
        const viewed = !!row.fileId && viewedFiles.has(row.fileId);
        return (
          <View
            style={[
              styles.file,
              {
                backgroundColor: theme.headerBackground,
                borderColor: theme.border,
                minHeight: surfaceStyle.fileHeaderHeight,
              },
            ]}
          >
            <Pressable
              style={styles.filePath}
              onPress={() => props.onToggleFile?.(nativeEvent({ fileId: row.fileId }))}
            >
              <Text
                numberOfLines={2}
                style={{
                  color: theme.text,
                  fontWeight: "600",
                  fontSize: surfaceStyle.fileHeaderFontSize,
                }}
              >
                {collapsed ? "▸ " : "▾ "}
                {row.filePath}
              </Text>
              {row.previousPath ? (
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.mutedText,
                    fontSize: surfaceStyle.fileHeaderSubtextFontSize,
                  }}
                >
                  from {row.previousPath}
                </Text>
              ) : null}
            </Pressable>
            <Text style={{ color: theme.addText, fontWeight: "600" }}>+{row.additions ?? 0}</Text>
            <Text style={{ color: theme.deleteText, fontWeight: "600" }}>
              -{row.deletions ?? 0}
            </Text>
            <Pressable
              onPress={() => props.onToggleViewedFile?.(nativeEvent({ fileId: row.fileId }))}
            >
              <Text style={{ color: viewed ? theme.addText : theme.mutedText, padding: 8 }}>
                {viewed ? "Viewed" : "Mark viewed"}
              </Text>
            </Pressable>
          </View>
        );
      }
      if (row.kind === "hunk")
        return (
          <Text
            selectable
            style={[
              styles.notice,
              {
                backgroundColor: theme.hunkBackground,
                color: theme.hunkText,
                fontSize: surfaceStyle.hunkFontSize,
              },
            ]}
          >
            {row.text}
          </Text>
        );
      if (row.kind === "notice")
        return (
          <Text
            selectable
            style={[styles.notice, { color: theme.mutedText, borderColor: theme.border }]}
          >
            {row.text}
          </Text>
        );
      if (row.kind === "comment") {
        const collapsed = collapsedComments.has(row.id);
        return (
          <Pressable
            style={[styles.comment, { borderColor: theme.border }]}
            onPress={() => props.onToggleComment?.(nativeEvent({ commentId: row.id }))}
          >
            <Text style={{ color: theme.mutedText, fontWeight: "600" }}>
              {collapsed ? "▸" : "▾"} {row.commentSectionTitle ?? "Comment"}
              {row.commentRangeLabel ? ` · ${row.commentRangeLabel}` : ""}
            </Text>
            {!collapsed ? (
              <Text selectable style={{ color: theme.text, marginTop: 4 }}>
                {row.commentText}
              </Text>
            ) : null}
          </Pressable>
        );
      }
      const changeColor =
        row.change === "add"
          ? theme.addBar
          : row.change === "delete"
            ? theme.deleteBar
            : "transparent";
      const backgroundColor = selectedRows.has(row.id)
        ? theme.hunkBackground
        : row.change === "add"
          ? theme.addBackground
          : row.change === "delete"
            ? theme.deleteBackground
            : theme.background;
      const content: ReactNode = (
        <TokenizedCode
          content={row.content ?? ""}
          tokens={tokens[row.id]}
          wordDiffRanges={row.wordDiffRanges}
          wordDiffColor={
            row.change === "add"
              ? "rgba(16, 185, 129, 0.24)"
              : row.change === "delete"
                ? "rgba(244, 63, 94, 0.24)"
                : undefined
          }
          color={theme.text}
          fontSize={surfaceStyle.codeFontSize ?? 13}
        />
      );
      return (
        <Pressable
          onPress={() => emitLine(row, "tap")}
          onLongPress={() => emitLine(row, "longPress")}
          style={[styles.line, { minHeight: props.rowHeight, backgroundColor }]}
        >
          <View
            style={{
              width: surfaceStyle.changeBarWidth,
              alignSelf: "stretch",
              backgroundColor: changeColor,
            }}
          />
          <Text
            style={[styles.gutter, { width: surfaceStyle.gutterWidth, color: theme.mutedText }]}
          >
            {row.oldLineNumber ?? ""}
          </Text>
          <Text
            style={[styles.gutter, { width: surfaceStyle.gutterWidth, color: theme.mutedText }]}
          >
            {row.newLineNumber ?? ""}
          </Text>
          <Text
            selectable
            style={{
              color: theme.text,
              flex: 1,
              fontFamily: "monospace",
              fontSize: surfaceStyle.codeFontSize ?? 13,
              paddingHorizontal: surfaceStyle.codePadding,
            }}
          >
            {content}
          </Text>
        </Pressable>
      );
    },
    [
      collapsedComments,
      collapsedFiles,
      emitLine,
      props,
      selectedRows,
      surfaceStyle,
      theme,
      tokens,
      viewedFiles,
    ],
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<NativeReviewDiffRow>[] }) => {
      const first = viewableItems[0];
      const fileId = first?.item.fileId ?? null;
      props.onVisibleFileChange?.(nativeEvent({ fileId }));
      if (viewableItems.length)
        props.onDebug?.(
          nativeEvent({
            message: "visible-range",
            firstRowIndex: first?.index ?? 0,
            lastRowIndex: viewableItems.at(-1)?.index ?? 0,
          }),
        );
    },
    [props.onDebug, props.onVisibleFileChange],
  );

  const listWidth = props.contentWidth + surfaceStyle.changeBarWidth + surfaceStyle.gutterWidth * 2;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={[styles.surface, { backgroundColor: theme.background }, props.style]}
    >
      <FlatList
        ref={listRef}
        testID={props.testID}
        accessibilityLabel={props.accessibilityLabel}
        data={visibleRows}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        style={{ width: listWidth }}
        refreshControl={
          props.onPullToRefresh ? (
            <RefreshControl
              refreshing={props.refreshing ?? false}
              onRefresh={() => props.onPullToRefresh?.(nativeEvent({}))}
            />
          ) : undefined
        }
        onViewableItemsChanged={onViewableItemsChanged}
        onScrollToIndexFailed={({ index }) =>
          listRef.current?.scrollToOffset({ offset: index * props.rowHeight, animated: false })
        }
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={9}
      />
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  file: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filePath: { flex: 1 },
  line: { alignItems: "center", flexDirection: "row" },
  surface: { flex: 1 },
  gutter: { fontFamily: "monospace", fontSize: 10, textAlign: "right", paddingRight: 6 },
  notice: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  comment: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    marginHorizontal: 8,
    padding: 10,
  },
});

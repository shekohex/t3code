package expo.modules.t3composereditor

import android.content.Context
import android.content.ClipboardManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.ReplacementSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

private data class ComposerToken(
  val type: String,
  val label: String,
  val start: Int,
  val end: Int,
)

private data class ComposerTheme(
  val text: Int = Color.rgb(38, 38, 38),
  val placeholder: Int = Color.rgb(142, 142, 147),
  val chipBackground: Int = Color.rgb(242, 242, 247),
  val chipBorder: Int = Color.rgb(222, 222, 227),
  val chipText: Int = Color.rgb(38, 38, 38),
  val skillBackground: Int = Color.rgb(249, 232, 251),
  val skillBorder: Int = Color.rgb(229, 166, 235),
  val skillText: Int = Color.rgb(162, 28, 175),
)

private class ComposerEditText(context: Context) : EditText(context) {
  var onSelectionChanged: (() -> Unit)? = null
  var onPasteImages: ((List<String>) -> Unit)? = null
  var tokenRanges: List<IntRange> = emptyList()
  private var normalizingSelection = false

  override fun onSelectionChanged(selectionStart: Int, selectionEnd: Int) {
    super.onSelectionChanged(selectionStart, selectionEnd)
    if (!normalizingSelection) {
      val normalized = normalizeSelection(selectionStart, selectionEnd)
      if (normalized.first != selectionStart || normalized.second != selectionEnd) {
        normalizingSelection = true
        setSelection(normalized.first, normalized.second)
        normalizingSelection = false
        return
      }
    }
    onSelectionChanged?.invoke()
  }

  override fun onCreateInputConnection(editorInfo: EditorInfo): InputConnection? {
    val connection = super.onCreateInputConnection(editorInfo) ?: return null
    return object : InputConnectionWrapper(connection, true) {
      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        if (selectionStart == selectionEnd) {
          val token = when {
            beforeLength == 1 && afterLength == 0 ->
              tokenRanges.firstOrNull { selectionStart == it.last + 1 }
            beforeLength == 0 && afterLength == 1 ->
              tokenRanges.firstOrNull { selectionStart == it.first }
            else -> null
          }
          if (token != null) {
            text?.delete(token.first, token.last + 1)
            return true
          }
        }
        return super.deleteSurroundingText(beforeLength, afterLength)
      }
    }
  }

  override fun onTextContextMenuItem(id: Int): Boolean {
    if (id == android.R.id.paste || id == android.R.id.pasteAsPlainText) {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = clipboard.primaryClip
      val description = clipboard.primaryClipDescription
      if (clip != null && description != null) {
        val containsImage = (0 until description.mimeTypeCount)
          .any { description.getMimeType(it).startsWith("image/") }
        if (containsImage) {
          val uris = (0 until clip.itemCount).mapNotNull { index ->
            clip.getItemAt(index).uri?.toString()
          }
          if (uris.isNotEmpty()) {
            onPasteImages?.invoke(uris)
            return true
          }
        }
      }
    }
    return super.onTextContextMenuItem(id)
  }

  private fun normalizeSelection(start: Int, end: Int): Pair<Int, Int> {
    if (start == end) {
      val token = tokenRanges.firstOrNull { start > it.first && start <= it.last }
        ?: return start to end
      val midpoint = (token.first + token.last + 1) / 2
      val boundary = if (start <= midpoint) token.first else token.last + 1
      return boundary to boundary
    }
    val normalizedStart = tokenRanges.firstOrNull { start > it.first && start <= it.last }
      ?.first ?: start
    val normalizedEnd = tokenRanges.firstOrNull { end > it.first && end <= it.last }
      ?.let { it.last + 1 } ?: end
    return normalizedStart to normalizedEnd
  }
}

private class ComposerChipSpan(
  private val label: String,
  private val backgroundColor: Int,
  private val borderColor: Int,
  private val textColor: Int,
  private val density: Float,
) : ReplacementSpan() {
  private val horizontalPadding = 9f * density
  private val verticalPadding = 3f * density
  private val cornerRadius = 7f * density

  override fun getSize(
    paint: Paint,
    text: CharSequence,
    start: Int,
    end: Int,
    fontMetrics: Paint.FontMetricsInt?,
  ): Int {
    val height = ceil(paint.fontMetrics.descent - paint.fontMetrics.ascent + verticalPadding * 2).toInt()
    fontMetrics?.let {
      val center = (it.ascent + it.descent) / 2
      it.ascent = center - height / 2
      it.descent = it.ascent + height
      it.top = it.ascent
      it.bottom = it.descent
    }
    return ceil(paint.measureText(label) + horizontalPadding * 2).toInt()
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    val width = paint.measureText(label) + horizontalPadding * 2
    val textHeight = paint.fontMetrics.descent - paint.fontMetrics.ascent
    val height = textHeight + verticalPadding * 2
    val chipTop = y + (paint.fontMetrics.ascent + paint.fontMetrics.descent - height) / 2
    val rect = RectF(x, chipTop, x + width, chipTop + height)
    val originalStyle = paint.style
    val originalColor = paint.color
    paint.style = Paint.Style.FILL
    paint.color = backgroundColor
    canvas.drawRoundRect(rect, cornerRadius, cornerRadius, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = density
    paint.color = borderColor
    canvas.drawRoundRect(rect, cornerRadius, cornerRadius, paint)
    paint.style = Paint.Style.FILL
    paint.color = textColor
    canvas.drawText(label, x + horizontalPadding, y.toFloat(), paint)
    paint.style = originalStyle
    paint.color = originalColor
  }
}

class T3ComposerEditorView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val editor = ComposerEditText(context)
  private val onComposerChange by EventDispatcher()
  private val onComposerSelectionChange by EventDispatcher()
  private val onComposerFocus by EventDispatcher()
  private val onComposerBlur by EventDispatcher()
  private val onComposerSubmit by EventDispatcher()
  private val onComposerPasteImages by EventDispatcher()
  private val onComposerContentSizeChange by EventDispatcher()
  private var theme = ComposerTheme()
  private var tokens: List<ComposerToken> = emptyList()
  private var nativeEventCount = 0
  private var applyingControlledDocument = false
  private var shouldAutoFocus = false
  private var didAutoFocus = false
  private var lineHeightPx = 0
  private var lastContentWidth = -1
  private var lastContentHeight = -1

  init {
    editor.setBackgroundColor(Color.TRANSPARENT)
    editor.gravity = Gravity.TOP or Gravity.START
    editor.setPadding(0, 0, 0, 0)
    editor.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
      InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
    editor.isSingleLine = false
    editor.setHorizontallyScrolling(false)
    editor.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
      override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
      override fun afterTextChanged(text: Editable) {
        if (applyingControlledDocument) return
        nativeEventCount += 1
        onComposerChange(eventPayload())
        emitContentSizeIfNeeded()
      }
    })
    editor.setOnFocusChangeListener { _, focused ->
      if (focused) onComposerFocus(emptyMap()) else onComposerBlur(emptyMap())
    }
    editor.onSelectionChanged = {
      if (!applyingControlledDocument) onComposerSelectionChange(eventPayload())
    }
    editor.onPasteImages = { uris -> onComposerPasteImages(mapOf("uris" to uris)) }
    editor.setOnKeyListener { _, keyCode, event ->
      if (
        keyCode == KeyEvent.KEYCODE_DEL &&
        event.action == KeyEvent.ACTION_DOWN &&
        editor.selectionStart == editor.selectionEnd
      ) {
        val token = editor.tokenRanges.firstOrNull { editor.selectionStart == it.last + 1 }
        if (token != null) {
          editor.text?.delete(token.first, token.last + 1)
          return@setOnKeyListener true
        }
      }
      val submit = keyCode == KeyEvent.KEYCODE_ENTER &&
        (event.isCtrlPressed || event.isMetaPressed)
      if (submit && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        onComposerSubmit(emptyMap())
      }
      submit
    }
    addView(editor, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setControlledDocumentJson(documentJson: String) {
    val document = runCatching { JSONObject(documentJson) }.getOrNull() ?: return
    val eventCount = document.optInt("mostRecentEventCount", -1)
    if (eventCount < nativeEventCount) return
    val nextValue = document.optString("value")
    if (document.optBoolean("isNativeEcho") && editor.text.toString() != nextValue) return
    tokens = decodeTokens(document.optString("tokensJson", "[]"), nextValue)
    editor.tokenRanges = tokens.map { it.start until it.end }
    val selection = document.optJSONObject("selection")
    applyingControlledDocument = true
    if (editor.text.toString() != nextValue) editor.setText(nextValue)
    applyTokenSpans()
    selection?.let {
      val start = it.optInt("start").coerceIn(0, editor.length())
      val end = it.optInt("end").coerceIn(start, editor.length())
      editor.setSelection(start, end)
    }
    applyingControlledDocument = false
    emitContentSizeIfNeeded()
  }

  fun setThemeJson(themeJson: String) {
    val value = runCatching { JSONObject(themeJson) }.getOrNull() ?: return
    theme = ComposerTheme(
      text = parseColor(value.optString("text"), theme.text),
      placeholder = parseColor(value.optString("placeholder"), theme.placeholder),
      chipBackground = parseColor(value.optString("chipBackground"), theme.chipBackground),
      chipBorder = parseColor(value.optString("chipBorder"), theme.chipBorder),
      chipText = parseColor(value.optString("chipText"), theme.chipText),
      skillBackground = parseColor(value.optString("skillBackground"), theme.skillBackground),
      skillBorder = parseColor(value.optString("skillBorder"), theme.skillBorder),
      skillText = parseColor(value.optString("skillText"), theme.skillText),
    )
    editor.setTextColor(theme.text)
    editor.setHintTextColor(theme.placeholder)
    applyTokenSpans()
  }

  fun setPlaceholder(value: String) { editor.hint = value }
  fun setFontFamily(value: String) { editor.typeface = Typeface.create(value, Typeface.NORMAL) }
  fun setFontSize(value: Float) { editor.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, value) }
  fun setLineHeight(value: Float) {
    lineHeightPx = (value * resources.displayMetrics.scaledDensity).roundToInt()
    applyLineHeight()
  }
  fun setContentInsetVertical(value: Float) {
    val inset = (value * resources.displayMetrics.density).roundToInt()
    editor.setPadding(0, inset, 0, inset)
  }
  fun setEditable(value: Boolean) { editor.isEnabled = value; editor.isFocusableInTouchMode = value }
  fun setScrollEnabled(value: Boolean) { editor.isVerticalScrollBarEnabled = value; editor.overScrollMode = if (value) OVER_SCROLL_IF_CONTENT_SCROLLS else OVER_SCROLL_NEVER }
  fun setAutoFocus(value: Boolean) { shouldAutoFocus = value; maybeAutoFocus() }
  fun setAutoCorrect(value: Boolean) { updateInputFlag(InputType.TYPE_TEXT_FLAG_AUTO_CORRECT, value) }
  fun setSpellCheck(value: Boolean) { updateInputFlag(InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, !value) }

  fun focusEditor() {
    editor.requestFocus()
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
      .showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT)
  }
  fun blurEditor() {
    editor.clearFocus()
    (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
      .hideSoftInputFromWindow(editor.windowToken, 0)
  }
  fun setEditorSelection(start: Int, end: Int) {
    val boundedStart = start.coerceIn(0, editor.length())
    val boundedEnd = end.coerceIn(boundedStart, editor.length())
    editor.setSelection(boundedStart, boundedEnd)
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); maybeAutoFocus() }
  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    emitContentSizeIfNeeded()
  }

  private fun maybeAutoFocus() {
    if (shouldAutoFocus && isAttachedToWindow && !didAutoFocus) {
      didAutoFocus = true
      post { focusEditor() }
    }
  }

  private fun applyTokenSpans() {
    val editable = editor.text ?: return
    editable.getSpans(0, editable.length, ComposerChipSpan::class.java)
      .forEach(editable::removeSpan)
    tokens.forEach { token ->
      val isSkill = token.type == "skill"
      editable.setSpan(
        ComposerChipSpan(
          token.label,
          if (isSkill) theme.skillBackground else theme.chipBackground,
          if (isSkill) theme.skillBorder else theme.chipBorder,
          if (isSkill) theme.skillText else theme.chipText,
          resources.displayMetrics.density,
        ),
        token.start,
        token.end,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
      )
    }
  }

  private fun decodeTokens(tokensJson: String, value: String): List<ComposerToken> {
    val array = runCatching { JSONArray(tokensJson) }.getOrNull() ?: return emptyList()
    return buildList {
      for (index in 0 until array.length()) {
        val token = array.optJSONObject(index) ?: continue
        val start = token.optInt("start", -1)
        val end = token.optInt("end", -1)
        val source = token.optString("source")
        if (start >= 0 && end > start && end <= value.length && value.substring(start, end) == source) {
          add(ComposerToken(token.optString("type"), token.optString("label"), start, end))
        }
      }
    }
  }

  private fun eventPayload(): Map<String, Any> = mapOf(
    "value" to editor.text.toString(),
    "selection" to mapOf("start" to max(0, editor.selectionStart), "end" to max(0, editor.selectionEnd)),
    "eventCount" to nativeEventCount,
  )

  private fun emitContentSizeIfNeeded() {
    post {
      val contentWidth = editor.layout?.let { layout ->
        (0 until layout.lineCount).maxOfOrNull { layout.getLineWidth(it) }?.let(::ceil)?.toInt()
      } ?: editor.measuredWidth
      val contentHeight = max(editor.measuredHeight, editor.layout?.height ?: 0) + editor.paddingTop + editor.paddingBottom
      if (contentWidth == lastContentWidth && contentHeight == lastContentHeight) return@post
      lastContentWidth = contentWidth
      lastContentHeight = contentHeight
      val density = resources.displayMetrics.density
      onComposerContentSizeChange(mapOf("width" to contentWidth / density, "height" to contentHeight / density))
    }
  }

  private fun applyLineHeight() {
    if (lineHeightPx <= 0) return
    val fontHeight = editor.paint.fontMetricsInt.let { it.descent - it.ascent }
    editor.setLineSpacing(max(0, lineHeightPx - fontHeight).toFloat(), 1f)
  }

  private fun updateInputFlag(flag: Int, enabled: Boolean) {
    editor.inputType = if (enabled) editor.inputType or flag else editor.inputType and flag.inv()
  }

  private fun parseColor(value: String, fallback: Int): Int =
    runCatching { Color.parseColor(value) }.getOrDefault(fallback)
}

package expo.modules.t3composereditor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3ComposerEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3ComposerEditor")

    View(T3ComposerEditorView::class) {
      Prop("controlledDocumentJson") { view: T3ComposerEditorView, value: String ->
        view.setControlledDocumentJson(value)
      }
      Prop("themeJson") { view: T3ComposerEditorView, value: String -> view.setThemeJson(value) }
      Prop("placeholder") { view: T3ComposerEditorView, value: String -> view.setPlaceholder(value) }
      Prop("fontFamily") { view: T3ComposerEditorView, value: String -> view.setFontFamily(value) }
      Prop("fontSize") { view: T3ComposerEditorView, value: Double -> view.setFontSize(value.toFloat()) }
      Prop("lineHeight") { view: T3ComposerEditorView, value: Double -> view.setLineHeight(value.toFloat()) }
      Prop("contentInsetVertical") { view: T3ComposerEditorView, value: Double ->
        view.setContentInsetVertical(value.toFloat())
      }
      Prop("editable") { view: T3ComposerEditorView, value: Boolean -> view.setEditable(value) }
      Prop("scrollEnabled") { view: T3ComposerEditorView, value: Boolean -> view.setScrollEnabled(value) }
      Prop("autoFocus") { view: T3ComposerEditorView, value: Boolean -> view.setAutoFocus(value) }
      Prop("autoCorrect") { view: T3ComposerEditorView, value: Boolean -> view.setAutoCorrect(value) }
      Prop("spellCheck") { view: T3ComposerEditorView, value: Boolean -> view.setSpellCheck(value) }

      Events(
        "onComposerChange",
        "onComposerSelectionChange",
        "onComposerFocus",
        "onComposerBlur",
        "onComposerSubmit",
        "onComposerPasteImages",
        "onComposerContentSizeChange",
      )

      AsyncFunction("focus") { view: T3ComposerEditorView -> view.focusEditor() }
      AsyncFunction("blur") { view: T3ComposerEditorView -> view.blurEditor() }
      AsyncFunction("setSelection") { view: T3ComposerEditorView, start: Int, end: Int ->
        view.setEditorSelection(start, end)
      }
    }
  }
}

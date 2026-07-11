package expo.modules.t3nativecontrols

import android.content.Context
import android.view.KeyEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class T3KeyboardCommandsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3KeyboardCommands")

    View(T3KeyboardCommandsView::class) {
      Prop("enabledCommands") { view: T3KeyboardCommandsView, commands: List<String> ->
        view.enabledCommands = commands.toSet()
      }

      Events("onCommand")
    }
  }
}

class T3KeyboardCommandsView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  var enabledCommands: Set<String> = emptySet()

  private val onCommand by EventDispatcher()

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val command = commandFor(event)
    if (command != null && enabledCommands.contains(command)) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        onCommand(mapOf("command" to command))
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun commandFor(event: KeyEvent): String? {
    if (!event.isCtrlPressed && !event.isMetaPressed) return null

    return when {
      event.keyCode == KeyEvent.KEYCODE_N && !event.isShiftPressed -> "newTask"
      event.keyCode == KeyEvent.KEYCODE_F && !event.isShiftPressed -> "focusSearch"
      event.keyCode == KeyEvent.KEYCODE_K && !event.isShiftPressed -> "focusSearch"
      event.keyCode == KeyEvent.KEYCODE_LEFT_BRACKET && !event.isShiftPressed -> "back"
      event.keyCode == KeyEvent.KEYCODE_F && event.isShiftPressed -> "files"
      event.keyCode == KeyEvent.KEYCODE_T && event.isShiftPressed -> "terminal"
      event.keyCode == KeyEvent.KEYCODE_R && event.isShiftPressed -> "review"
      event.keyCode == KeyEvent.KEYCODE_BACKSLASH && !event.isShiftPressed -> "toggleSidebar"
      else -> null
    }
  }
}

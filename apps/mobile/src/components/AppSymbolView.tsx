import {
  SymbolView as ExpoSymbolView,
  type AndroidSymbol,
  type SFSymbol,
  type SymbolViewProps,
} from "expo-symbols";

const ANDROID_SYMBOLS: Readonly<Record<string, AndroidSymbol>> = {
  SidebarThreads: "view_sidebar",
  archivebox: "archive",
  "archivebox.fill": "archive",
  "arrow.branch": "fork_right",
  "arrow.clockwise": "refresh",
  "arrow.down.circle": "arrow_circle_down",
  "arrow.right.circle": "arrow_circle_right",
  "arrow.triangle.branch": "account_tree",
  "arrow.turn.left.up": "subdirectory_arrow_left",
  "arrow.up": "arrow_upward",
  "arrow.up.left.and.arrow.down.right": "open_in_full",
  "arrow.up.right": "north_east",
  "bell.badge": "notifications_unread",
  "bolt.circle": "offline_bolt",
  camera: "camera_alt",
  checkmark: "check",
  "checkmark.circle": "check_circle",
  "chevron.down": "keyboard_arrow_down",
  "chevron.left": "chevron_left",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron_right",
  desktopcomputer: "computer",
  "doc.on.doc": "content_copy",
  "doc.text": "description",
  ellipsis: "more_horiz",
  "exclamationmark.triangle": "warning",
  eye: "visibility",
  folder: "folder",
  "folder.badge.plus": "create_new_folder",
  "folder.fill": "folder",
  gearshape: "settings",
  "info.circle": "info",
  internaldrive: "hard_drive",
  link: "link",
  magnifyingglass: "search",
  paintbrush: "palette",
  "person.crop.circle": "account_circle",
  play: "play_arrow",
  plus: "add",
  "point.3.connected.trianglepath.dotted": "device_hub",
  "point.topleft.down.curvedto.point.bottomright.up": "conversion_path",
  "qrcode.viewfinder": "qr_code_scanner",
  safari: "public",
  "server.rack": "dns",
  "sidebar.left": "dock_to_left",
  "sidebar.right": "dock_to_right",
  "slider.horizontal.3": "tune",
  "square.and.pencil": "edit",
  "square.split.2x1": "split_scene",
  "stop.fill": "stop",
  terminal: "terminal",
  "text.bubble": "chat",
  "text.word.spacing": "format_letter_spacing",
  "textformat.size": "format_size",
  "textformat.size.larger": "text_increase",
  "textformat.size.smaller": "text_decrease",
  trash: "delete",
  "tray.and.arrow.up": "upload",
  "wifi.slash": "wifi_off",
  xmark: "close",
};

export type { SFSymbol };

export function SymbolView(props: SymbolViewProps) {
  const name =
    typeof props.name === "string"
      ? {
          ios: props.name,
          android: ANDROID_SYMBOLS[props.name] ?? "help",
          web: ANDROID_SYMBOLS[props.name] ?? "help",
        }
      : props.name;
  return <ExpoSymbolView {...props} name={name} />;
}

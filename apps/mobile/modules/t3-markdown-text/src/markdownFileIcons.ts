import type { ImageSourcePropType } from "react-native";

import type { MarkdownFileIcon } from "./markdownLinks";

const MARKDOWN_FILE_ICON_SOURCES: Readonly<Record<MarkdownFileIcon, ImageSourcePropType>> = {
  agents: require("../assets/file-icons/file_type_agents.png"),
  c: require("../assets/file-icons/file_type_c.png"),
  cpp: require("../assets/file-icons/file_type_cpp.png"),
  css: require("../assets/file-icons/file_type_css.png"),
  default: require("../assets/file-icons/default_file.png"),
  go: require("../assets/file-icons/file_type_go.png"),
  html: require("../assets/file-icons/file_type_html.png"),
  java: require("../assets/file-icons/file_type_java.png"),
  javascript: require("../assets/file-icons/file_type_js.png"),
  json: require("../assets/file-icons/file_type_json.png"),
  kotlin: require("../assets/file-icons/file_type_kotlin.png"),
  markdown: require("../assets/file-icons/file_type_markdown.png"),
  npm: require("../assets/file-icons/file_type_npm.png"),
  python: require("../assets/file-icons/file_type_python.png"),
  "react-typescript": require("../assets/file-icons/file_type_reactts.png"),
  rust: require("../assets/file-icons/file_type_rust.png"),
  shell: require("../assets/file-icons/file_type_shell.png"),
  sql: require("../assets/file-icons/file_type_sql.png"),
  swift: require("../assets/file-icons/file_type_swift.png"),
  toml: require("../assets/file-icons/file_type_toml.png"),
  tsconfig: require("../assets/file-icons/file_type_tsconfig.png"),
  typescript: require("../assets/file-icons/file_type_typescript.png"),
  xml: require("../assets/file-icons/file_type_xml.png"),
  yaml: require("../assets/file-icons/file_type_yaml.png"),
};

export function markdownFileIconSource(icon: MarkdownFileIcon): ImageSourcePropType {
  return MARKDOWN_FILE_ICON_SOURCES[icon];
}

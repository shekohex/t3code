const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;
const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;
const RELATIVE_FILE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+){0,2}$/;
const RELATIVE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+(?::\d+){0,2}$/;
const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const POSIX_FILE_ROOT_PREFIXES = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/var/",
  "/etc/",
  "/opt/",
  "/mnt/",
  "/Volumes/",
  "/private/",
  "/root/",
] as const;

export type MarkdownLinkPresentation =
  | {
      readonly kind: "external";
      readonly href: string;
      readonly host: string;
    }
  | {
      readonly kind: "file";
      readonly icon: MarkdownFileIcon;
      readonly label: string;
    }
  | {
      readonly kind: "link";
      readonly href: string | null;
    };

export type MarkdownFileIcon =
  | "agents"
  | "c"
  | "cpp"
  | "css"
  | "default"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "markdown"
  | "npm"
  | "python"
  | "react-typescript"
  | "rust"
  | "shell"
  | "sql"
  | "swift"
  | "toml"
  | "tsconfig"
  | "typescript"
  | "xml"
  | "yaml";

const FILE_ICON_BY_EXTENSION: Readonly<Record<string, MarkdownFileIcon>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  css: "css",
  go: "go",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mdc: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  scss: "css",
  sh: "shell",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "react-typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeDestination(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

function fileUrlPath(href: string): string | null {
  try {
    const parsed = new URL(href);
    if (parsed.protocol.toLowerCase() !== "file:") {
      return null;
    }
    const path = /^\/[A-Za-z]:[\\/]/.test(parsed.pathname)
      ? parsed.pathname.slice(1)
      : parsed.pathname;
    const lineMatch = parsed.hash.match(/^#L(\d+)(?:C(\d+))?$/i);
    return `${safeDecode(path)}${
      lineMatch?.[1] ? `:${lineMatch[1]}${lineMatch[2] ? `:${lineMatch[2]}` : ""}` : ""
    }`;
  } catch {
    return null;
  }
}

function looksLikePosixFilesystemPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  if (POSITION_SUFFIX_PATTERN.test(path)) {
    return true;
  }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return /\.[A-Za-z0-9_-]+$/.test(basename);
}

function looksLikeFilePath(value: string): boolean {
  if (WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value)) {
    return true;
  }
  if (RELATIVE_PATH_PREFIX_PATTERN.test(value)) {
    return true;
  }
  if (value.startsWith("/")) {
    return looksLikePosixFilesystemPath(value);
  }
  return RELATIVE_FILE_PATH_PATTERN.test(value) || RELATIVE_FILE_NAME_PATTERN.test(value);
}

function fileLabel(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename || normalized;
}

export function resolveMarkdownFileIcon(value: string): MarkdownFileIcon {
  const basename = fileLabel(value).replace(POSITION_SUFFIX_PATTERN, "").toLowerCase();
  if (basename === "agents.md") {
    return "agents";
  }
  if (basename === "package.json") {
    return "npm";
  }
  if (
    basename === "tsconfig.json" ||
    (basename.startsWith("tsconfig.") && basename.endsWith(".json"))
  ) {
    return "tsconfig";
  }
  const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1) : "";
  return FILE_ICON_BY_EXTENSION[extension] ?? "default";
}

export function resolveMarkdownLinkPresentation(href: string): MarkdownLinkPresentation {
  const normalized = normalizeDestination(href);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return {
        kind: "external",
        href: parsed.toString(),
        host: parsed.hostname,
      };
    }
  } catch {
    // Relative paths and non-URL link destinations are handled below.
  }

  const fileTarget = normalized.toLowerCase().startsWith("file:")
    ? fileUrlPath(normalized)
    : safeDecode(normalized.split(/[?#]/, 1)[0] ?? normalized);
  if (fileTarget && looksLikeFilePath(fileTarget)) {
    return {
      kind: "file",
      icon: resolveMarkdownFileIcon(fileTarget),
      label: fileLabel(fileTarget),
    };
  }

  return {
    kind: "link",
    href: /^(?:mailto|tel):/i.test(normalized) ? normalized : null,
  };
}

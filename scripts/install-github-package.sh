#!/usr/bin/env bash

set -euo pipefail

readonly package_scope='@shekohex'
readonly package_name='@shekohex/t3'
readonly registry_url='https://npm.pkg.github.com'

package_manager="${T3_PACKAGE_MANAGER:-npm}"
package_version="${T3_PACKAGE_VERSION:-}"
default_package_version='preview'
token_value=''
token_source=''
temporary_directory=''

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: install-github-package.sh [--npm|--pnpm|--bun|--yarn] [--version VERSION]

Auth lookup: NODE_AUTH_TOKEN, NPM_TOKEN, GH_TOKEN, GITHUB_TOKEN, then gh auth token.

Examples:
  curl -fsSL https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.sh | bash -s -- --npm
  curl -fsSL https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.sh | bash -s -- --pnpm
  T3_PACKAGE_MANAGER=bun T3_PACKAGE_VERSION=0.0.33+1.1.abcdef123456 ./scripts/install-github-package.sh
EOF
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --npm) package_manager='npm' ;;
      --pnpm) package_manager='pnpm' ;;
      --bun) package_manager='bun' ;;
      --yarn) package_manager='yarn' ;;
      --version)
        [[ $# -ge 2 ]] || fail '--version requires value'
        package_version="$2"
        shift
        ;;
      --help|-h) usage ;;
      *) fail "unknown argument: $1" ;;
    esac
    shift
  done

  case "$package_manager" in
    npm|pnpm|bun|yarn) ;;
    *) fail "unsupported package manager: $package_manager" ;;
  esac
}

resolve_auth_token() {
  local candidate_name
  for candidate_name in NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN; do
    if [[ -n "${!candidate_name:-}" ]]; then
      token_source="$candidate_name"
      token_value="${!candidate_name}"
      return
    fi
  done

  if command -v gh >/dev/null 2>&1; then
    token_value="$(gh auth token 2>/dev/null || true)"
    if [[ -n "$token_value" ]]; then
      token_source='gh auth token'
      return
    fi
  fi

  fail 'GitHub token missing. Set GH_TOKEN or run: gh auth login; gh auth refresh -s read:packages.'
}

install_package() {
  local npmrc_path package_reference
  temporary_directory="$(mktemp -d)"
  npmrc_path="$temporary_directory/.npmrc"
  package_reference="${package_name}@${package_version:-$default_package_version}"

  printf '%s\n%s\n' \
    "${package_scope}:registry=${registry_url}" \
    "//npm.pkg.github.com/:_authToken=${token_value}" > "$npmrc_path"

  printf 'Installing %s with %s using token from %s\n' "$package_reference" "$package_manager" "$token_source" >&2

  case "$package_manager" in
    npm)
      require_command npm
      npm install --global "$package_reference" --userconfig "$npmrc_path"
      ;;
    pnpm)
      require_command pnpm
      NPM_CONFIG_USERCONFIG="$npmrc_path" pnpm add --global "$package_reference"
      ;;
    bun)
      require_command bun
      XDG_CONFIG_HOME="$temporary_directory" bun add --global "$package_reference"
      ;;
    yarn)
      require_command yarn
      yarn global add "$package_reference" --userconfig "$npmrc_path"
      ;;
  esac
}

main() {
  trap '[[ -z "$temporary_directory" ]] || rm -rf -- "$temporary_directory"' EXIT
  parse_args "$@"
  resolve_auth_token
  install_package
}

main "$@"

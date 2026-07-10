#!/usr/bin/env bash

set -euo pipefail

package_manager='npm'
package_version='__T3_PACKAGE_VERSION__'
token=''

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --npm|--pnpm|--bun|--yarn) package_manager="${1#--}" ;;
    --version)
      [[ $# -ge 2 ]] || fail '--version requires value'
      package_version="$2"
      shift
      ;;
    --help|-h)
      printf 'Usage: install-github-package.sh [--npm|--pnpm|--bun|--yarn] [--version VERSION]\n'
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

for variable_name in NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN; do
  variable_value="${!variable_name:-}"
  if [[ -n "$variable_value" ]]; then
    token="$variable_value"
    break
  fi
done

if [[ -z "$token" ]] && command -v gh >/dev/null 2>&1; then
  token="$(gh auth token 2>/dev/null || true)"
fi

[[ -n "$token" ]] || fail 'GitHub token required. Run `gh auth refresh -s read:packages` or set NODE_AUTH_TOKEN.'
command -v "$package_manager" >/dev/null 2>&1 || fail "missing required command: $package_manager"

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
printf '%s\n%s\n' \
  '@shekohex:registry=https://npm.pkg.github.com' \
  "//npm.pkg.github.com/:_authToken=$token" > "$temp_dir/.npmrc"

package_ref="@shekohex/t3@$package_version"
case "$package_manager" in
  npm) npm install --global "$package_ref" --userconfig "$temp_dir/.npmrc" ;;
  pnpm) NPM_CONFIG_USERCONFIG="$temp_dir/.npmrc" pnpm add --global "$package_ref" ;;
  bun) XDG_CONFIG_HOME="$temp_dir" bun add --global "$package_ref" ;;
  yarn) yarn global add "$package_ref" --userconfig "$temp_dir/.npmrc" ;;
esac

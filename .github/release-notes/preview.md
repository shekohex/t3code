## Changelog

{{CHANGELOG_BODY}}

## Install

GitHub Packages requires a token with `read:packages`. Installers check `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token`.

### UNIX

```bash
curl -fsSL {{INSTALL_SCRIPT_URL}} | bash -s -- --npm
```

Use `--pnpm`, `--bun`, or `--yarn` instead when preferred.

### Windows PowerShell

```powershell
$env:T3_PACKAGE_MANAGER='npm'; irm {{WINDOWS_INSTALL_SCRIPT_URL}} | iex
```

Set `T3_PACKAGE_MANAGER` to `pnpm`, `bun`, or `yarn` when preferred.

## Package

`@shekohex/t3@{{PACKAGE_VERSION}}` published under `preview` tag. Package contains server and bundled web client.

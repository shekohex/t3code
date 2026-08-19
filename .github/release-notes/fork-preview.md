## Install

Published package: `@shekohex/t3@{{PACKAGE_VERSION}}`

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

GitHub Packages requires authentication. Installer checks `NODE_AUTH_TOKEN`, `NPM_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token`. Token needs `read:packages`.

## Changes

{{CHANGELOG_BODY}}

Rolling preview from latest `main` commit.

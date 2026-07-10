#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
$packageManager = if ($env:T3_PACKAGE_MANAGER) { $env:T3_PACKAGE_MANAGER } else { 'npm' }
$packageVersion = if ($env:T3_PACKAGE_VERSION) { $env:T3_PACKAGE_VERSION } else { '__T3_PACKAGE_VERSION__' }

foreach ($argument in $args) {
  switch ($argument) {
    '--npm' { $packageManager = 'npm' }
    '--pnpm' { $packageManager = 'pnpm' }
    '--bun' { $packageManager = 'bun' }
    '--yarn' { $packageManager = 'yarn' }
    default { throw "unknown argument: $argument" }
  }
}

$token = @($env:NODE_AUTH_TOKEN, $env:NPM_TOKEN, $env:GH_TOKEN, $env:GITHUB_TOKEN) |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -First 1
if (-not $token -and (Get-Command gh -ErrorAction SilentlyContinue)) {
  $token = gh auth token 2>$null
}
if (-not $token) {
  throw 'GitHub token required. Run `gh auth refresh -s read:packages` or set NODE_AUTH_TOKEN.'
}
if (-not (Get-Command $packageManager -ErrorAction SilentlyContinue)) {
  throw "missing required command: $packageManager"
}

$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
try {
  $npmrc = Join-Path $tempDirectory '.npmrc'
  Set-Content $npmrc @(
    '@shekohex:registry=https://npm.pkg.github.com'
    "//npm.pkg.github.com/:_authToken=$token"
  )
  $packageReference = "@shekohex/t3@$packageVersion"
  switch ($packageManager) {
    'npm' { npm install --global $packageReference --userconfig $npmrc }
    'pnpm' { $env:NPM_CONFIG_USERCONFIG = $npmrc; pnpm add --global $packageReference }
    'bun' { $env:XDG_CONFIG_HOME = $tempDirectory; bun add --global $packageReference }
    'yarn' { yarn global add $packageReference --userconfig $npmrc }
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Remove-Item $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

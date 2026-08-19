#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

$packageScope = '@shekohex'
$packageName = '@shekohex/t3'
$registryUrl = 'https://npm.pkg.github.com'
$packageManager = if ($env:T3_PACKAGE_MANAGER) { $env:T3_PACKAGE_MANAGER.ToLowerInvariant() } else { 'npm' }
$packageVersion = if ($env:T3_PACKAGE_VERSION) { $env:T3_PACKAGE_VERSION } else { '' }
$defaultPackageVersion = 'preview'
$tokenValue = ''
$tokenSource = ''

function Fail {
  param([string]$Message)

  Write-Error $Message
  exit 1
}

function Show-Usage {
  [Console]::Error.WriteLine(@'
Usage: install-github-package.ps1 [-Npm|-Pnpm|-Bun|-Yarn] [-Version VERSION]

Auth lookup: NODE_AUTH_TOKEN, NPM_TOKEN, GH_TOKEN, GITHUB_TOKEN, then gh auth token.

Examples:
  $env:T3_PACKAGE_MANAGER='npm'; irm https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.ps1 | iex
  $env:T3_PACKAGE_MANAGER='pnpm'; irm https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.ps1 | iex
  ./scripts/install-github-package.ps1 -Bun -Version 0.0.33+1.1.abcdef123456
'@)
  exit 1
}

function Parse-Arguments {
  param([string[]]$Arguments)

  $argumentIndex = 0
  while ($argumentIndex -lt $Arguments.Length) {
    switch ($Arguments[$argumentIndex]) {
      '--npm' { $script:packageManager = 'npm' }
      '-Npm' { $script:packageManager = 'npm' }
      '--pnpm' { $script:packageManager = 'pnpm' }
      '-Pnpm' { $script:packageManager = 'pnpm' }
      '--bun' { $script:packageManager = 'bun' }
      '-Bun' { $script:packageManager = 'bun' }
      '--yarn' { $script:packageManager = 'yarn' }
      '-Yarn' { $script:packageManager = 'yarn' }
      '--version' {
        if ($argumentIndex + 1 -ge $Arguments.Length) { Fail '--version requires value' }
        $script:packageVersion = $Arguments[$argumentIndex + 1]
        $argumentIndex += 1
      }
      '-Version' {
        if ($argumentIndex + 1 -ge $Arguments.Length) { Fail '-Version requires value' }
        $script:packageVersion = $Arguments[$argumentIndex + 1]
        $argumentIndex += 1
      }
      '--help' { Show-Usage }
      '-Help' { Show-Usage }
      '-h' { Show-Usage }
      default { Fail "unknown argument: $($Arguments[$argumentIndex])" }
    }
    $argumentIndex += 1
  }

  if ($script:packageManager -notin @('npm', 'pnpm', 'bun', 'yarn')) {
    Fail "unsupported package manager: $script:packageManager"
  }
}

function Require-Command {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    Fail "missing required command: $CommandName"
  }
}

function Resolve-AuthToken {
  $tokenCandidates = @(
    @{ Name = 'NODE_AUTH_TOKEN'; Value = $env:NODE_AUTH_TOKEN },
    @{ Name = 'NPM_TOKEN'; Value = $env:NPM_TOKEN },
    @{ Name = 'GH_TOKEN'; Value = $env:GH_TOKEN },
    @{ Name = 'GITHUB_TOKEN'; Value = $env:GITHUB_TOKEN }
  )

  foreach ($tokenCandidate in $tokenCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($tokenCandidate.Value)) {
      $script:tokenSource = $tokenCandidate.Name
      $script:tokenValue = $tokenCandidate.Value
      return
    }
  }

  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $resolvedToken = & gh auth token 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($resolvedToken)) {
      $script:tokenSource = 'gh auth token'
      $script:tokenValue = $resolvedToken.Trim()
      return
    }
  }

  Fail 'GitHub token missing. Set GH_TOKEN or run `gh auth login` then `gh auth refresh -s read:packages`.'
}

function Install-GitHubPackage {
  $tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
  $null = New-Item -ItemType Directory -Path $tempDirectory
  $npmrcPath = Join-Path $tempDirectory '.npmrc'
  $resolvedVersion = if ($script:packageVersion) { $script:packageVersion } else { $defaultPackageVersion }
  $packageReference = "${packageName}@${resolvedVersion}"
  $previousNpmConfigUserconfig = $env:NPM_CONFIG_USERCONFIG
  $previousXdgConfigHome = $env:XDG_CONFIG_HOME

  Set-Content -Path $npmrcPath -Value @(
    "${packageScope}:registry=${registryUrl}"
    "//npm.pkg.github.com/:_authToken=$script:tokenValue"
  )

  [Console]::Error.WriteLine("Installing $packageReference with $script:packageManager using token from $script:tokenSource")

  try {
    switch ($script:packageManager) {
      'npm' {
        Require-Command 'npm'
        & npm install --global $packageReference --userconfig $npmrcPath
      }
      'pnpm' {
        Require-Command 'pnpm'
        $env:NPM_CONFIG_USERCONFIG = $npmrcPath
        & pnpm add --global $packageReference
      }
      'bun' {
        Require-Command 'bun'
        $env:XDG_CONFIG_HOME = $tempDirectory
        & bun add --global $packageReference
      }
      'yarn' {
        Require-Command 'yarn'
        & yarn global add $packageReference --userconfig $npmrcPath
      }
    }

    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  finally {
    if ($null -eq $previousNpmConfigUserconfig) {
      Remove-Item Env:NPM_CONFIG_USERCONFIG -ErrorAction SilentlyContinue
    } else {
      $env:NPM_CONFIG_USERCONFIG = $previousNpmConfigUserconfig
    }
    if ($null -eq $previousXdgConfigHome) {
      Remove-Item Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue
    } else {
      $env:XDG_CONFIG_HOME = $previousXdgConfigHome
    }
    Remove-Item -Path $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Parse-Arguments -Arguments $args
Resolve-AuthToken
Install-GitHubPackage

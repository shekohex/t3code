# Fork Maintenance

This repository is `shekohex/t3code`, a small fork of upstream T3 Code. Keep fork delta additive, reviewable, and easy to replay.

## Invariants

- `upstream` points to direct parent `mwolson/t3code`; `origin` points to `shekohex/t3code`.
- GitHub fork-network source is `pingdotgg/t3code`, but fork maintenance rebases against direct parent `mwolson/t3code`.
- `main` should equal `upstream/main` plus one fork-maintenance commit.
- Amend fork changes into that commit. Do not accumulate merge commits or drive-by formatting.
- Prefer upstream versions of conflicts unless a fork-owned file requires fork behavior.
- Never modify upstream `.github/workflows/release.yml` for fork publishing.
- Never commit generated or unrelated working-tree changes.
- Commit, force-push, publish manually, or change repository settings only when explicitly requested.

## Fork-owned files

- `.github/workflows/fork-preview-release.yml`
- `.github/release-notes/fork-preview.md`
- `.github/FORK_MAINTENANCE.md`
- `scripts/install-github-package.sh`
- `scripts/install-github-package.ps1`
- `.agents/skills/maintain-t3-fork/`

Keep app and package source identical to upstream. CI temporarily renames npm package from `t3` to `@shekohex/t3`; source manifests remain unchanged.

## Continuous preview release

Pushes to `main` run `Fork Preview Release`:

1. Build resource-monitor binaries for supported macOS, Linux, and Windows targets.
2. Derive unique package version `<upstream-version>-preview.<run>.<attempt>.<sha>`.
3. Build web and CLI packages with exact upstream version so client and server runtime versions remain equal.
4. After building, temporarily set npm package metadata and publish as `@shekohex/t3` to `https://npm.pkg.github.com` with `preview` tag.
5. Move rolling `fork-preview` GitHub release to published commit and replace installer assets.

npm ignores SemVer build metadata (`+...`) when identifying package versions, so registry uniqueness requires a prerelease suffix. T3 compares client and server versions as exact strings, so neither prerelease nor build metadata may be embedded as runtime version. Package version and runtime version are intentionally different.

Workflow uses repository `GITHUB_TOKEN`; no npm token secret needed. Repository Actions settings must allow read/write workflow permissions. Job explicitly requests `packages: write` and `contents: write`. Existing packages must also grant `shekohex/t3code` Write access under package settings → Manage Actions access; `GITHUB_TOKEN` cannot grant itself access.

Install current preview:

```bash
curl -fsSL https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.sh | bash -s -- --npm
```

```powershell
$env:T3_PACKAGE_MANAGER='npm'; irm https://raw.githubusercontent.com/shekohex/t3code/main/scripts/install-github-package.ps1 | iex
```

GitHub Packages requires a token with `read:packages`, even for public packages. Installers check standard token environment variables, then `gh auth token`. Refresh CLI token with `gh auth refresh -s read:packages`.

## Sync upstream

Before mutation, confirm clean scope and expected topology:

```bash
git status --short
git remote -v
git remote get-url upstream
git remote get-url origin
```

Expected URLs:

```text
upstream: git@github.com:mwolson/t3code.git
origin: git@github.com:shekohex/t3code.git
```

HTTPS equivalents are valid. If `upstream` points elsewhere, stop and report it before fetching or changing remote configuration. Once remotes are correct:

```bash
git fetch upstream
git fetch origin
git log --oneline --decorate upstream/main..main
```

Expected output: exactly one fork commit. Then rebase:

```bash
git rebase upstream/main
```

Resolve conflicts surgically. Preserve upstream code and fork-owned behavior. Continue rebase, then verify:

```bash
git log --oneline upstream/main..main
git diff --stat upstream/main...main
actionlint .github/workflows/fork-preview-release.yml
bash -n scripts/install-github-package.sh
shellcheck scripts/install-github-package.sh
```

Expected log: one commit. Push rewritten history only after explicit authorization:

```bash
git push --force-with-lease origin main
```

## Add or change fork behavior

Read this document first. Keep edits within fork-owned files when possible. Validate focused scope. When explicitly asked to commit, amend single fork commit rather than adding another:

```bash
git add <fork-owned-files>
git commit --amend
```

If topology is not exactly one fork commit, stop and report it before rewriting history.

---
name: maintain-t3-fork
description: Maintain the shekohex/t3code fork, preserve its single-commit delta, sync or rebase against upstream, and update its GitHub Packages preview release. Use for fork maintenance, upstream sync, fork rebases, or fork release changes in this repository.
---

# Maintain T3 Fork

Read [the fork playbook](../../../.github/FORK_MAINTENANCE.md) completely before inspecting or changing fork state. Treat it as source of truth for topology, owned files, publishing behavior, validation, and install commands.

Before rebasing or amending, verify remote URLs, branch, worktree, and commit count relative to direct-parent `upstream/main`. Here, `upstream` is `mwolson/t3code`; `pingdotgg/t3code` is fork-network source, not rebase target. Preserve unrelated changes. If a remote or topology differs from playbook expectation, stop before fetching or rewriting history and report exact state.

Keep changes surgical and additive. Prefer upstream code during conflict resolution; preserve fork behavior only in documented fork-owned files. Do not modify upstream release workflow to implement fork publishing.

Do not commit, force-push, dispatch workflows, publish packages, or change GitHub settings unless user explicitly requests corresponding mutation. When commit is requested and topology matches playbook, amend fork commit so `upstream/main..main` remains one commit.

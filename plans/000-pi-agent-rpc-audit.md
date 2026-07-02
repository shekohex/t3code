# Pi Agent RPC Audit

Status: remediation partially implemented. Stock Pi RPC remains intentionally non-parity for MCP and T3 approval modes.

Audited revision: `0de374b28` (`feat(pi): add Pi agent provider`)

Upstream reference: `/home/coder/.cache/checkouts/github.com/earendil-works/pi` at `bc469b03` (`@earendil-works/pi-coding-agent` `0.80.6`).

Scope: T3 Pi driver, RPC runtime, adapter, provider snapshot, text generation, direct web/mobile integration points, and parity with existing Codex/other provider adapters. This is not a whole-monorepo audit and does not audit the external wrapper implementation.

## Remediation Status

Implemented in this worktree:

- P0-01 / P1-07: turns and one-shot generation settle on `agent_settled`; stream errors, retry failure, explicit interrupts, and process exits preserve terminal state.
- P0-04: extension UI responses validate pending IDs, clear accepted requests, and emit resolution events.
- P0-05: same-thread starts, sends, interrupts, responses, stops, and rollback serialize correctly; failed prompts restore session state.
- P1-08: Pi uses public `set_model` / `set_thinking_level`, refreshes actual state after configuration, exposes supported thinking levels, and hides plan mode.
- P1-09: provider snapshots follow shared settings/update-check behavior; native Pi RPC events log best-effort through `ProviderEventLoggers`.
- P1-10: adapter lifecycle and one-shot generation tests cover settlement, failures, retries, process exits, configuration, rollback, UI resolution, logging, and concurrent sends.
- P2-11: Pi display name and mobile icon are registered.

Partially addressed:

- P0-02: removed private `extension_event` transport. Rollback now uses public `get_entries` plus `fork`, refreshes the logical thread's resume cursor, and persists that cursor through `ProviderService`. This creates a Pi branch/session file rather than performing in-place tree navigation.
- P0-03: Pi rejects non-`full-access` sessions rather than silently misrepresenting its static CLI tool flags as T3 permission enforcement.

Still blocked on an owned Pi bridge:

- P0-03: Pi needs a permission bridge to support supervised and auto-accept-edits modes.
- P0-06: Pi receives no thread-bound T3 MCP server.
- P2-11: root/provider setup documentation still needs supported-version and limitation guidance.

## Executive Verdict

Pi provider now uses stock public Pi RPC with correct turn/session lifecycle and surface controls. Do not represent it as Codex-parity until a permission bridge and thread-bound T3 MCP bridge exist.

## Vetted Findings

### P0-01: Complete turns on `agent_settled`, not `agent_end`

- Evidence:
  - `apps/server/src/provider/Layers/PiAdapter.ts:1237-1251` treats every `agent_end` as terminal, clears `activeTurnId`, and emits `turn.completed`.
  - `apps/server/src/textGeneration/PiTextGeneration.ts:131-156` also completes one-shot generation on `agent_end`.
  - Upstream Pi RPC documents `agent_end` as a low-level run that can be followed by retry, compaction retry, or queued continuation, and `agent_settled` as final: `/home/coder/.cache/checkouts/github.com/earendil-works/pi/packages/coding-agent/docs/rpc.md:810-812,836-853`.
- Impact: retry/compaction/queued continuation creates false completed turns and transiently marks Pi ready. A user message in that interval is sent as a bare `prompt` instead of a steer, which Pi rejects while still streaming. One-shot text generation can read/kill before retries settle.
- Fix: retain current T3 turn through `agent_end`; use it only to finish message blocks and capture failure state. Complete on `agent_settled`. Track `assistantMessageEvent.error`, explicit abort, retry final failure, and non-zero process exits to emit failed/interrupted outcomes rather than unconditional completion.
- Verification: unit-test retry, compaction retry, queued continuation, abort, and one-shot text generation against captured Pi RPC fixtures.

### P0-02: Version and own required extension bridge, or explicitly disable rollback

- Evidence:
  - `apps/server/src/provider/piRpcRuntime.ts:142-176` sends a private `{ type: "extension_event" }` request and waits for a private `t3:rpc:response` event.
  - `apps/server/src/provider/Layers/PiAdapter.ts:1691-1712` depends on it for `t3:get-tree` and `t3:navigate-tree` rollback operations.
  - Current upstream `RpcCommand` has no `extension_event`: `/home/coder/.cache/checkouts/github.com/earendil-works/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts:20-70`. Its unknown-command handler returns an error: `rpc-mode.ts:689-692`.
  - Upstream does expose standard `get_entries` and `get_tree`, but not public in-place tree navigation: `rpc-mode.ts:612-628`.
- Impact: default/stock Pi is incompatible with the T3 rollback path. The adapter has no version pin, capability handshake, bridge loader, or degraded-mode declaration. If an external wrapper supplies this private protocol, T3 still cannot detect its absence or version skew.
- Fix: make bridge an owned, versioned dependency and launch it deterministically, then probe its capabilities before advertising rollback/rich UI. Use standard `get_entries` for read-only tree inspection. Keep in-place rollback behind the bridge; do not silently substitute `fork` because it creates a new session and changes T3 rollback semantics.
- Verification: stock-Pi capability failure is explicit; supported-wrapper handshake passes; rollback preserves expected session/branch semantics; reconnect uses updated resume cursor if a fork-based fallback is intentionally designed.

### P0-03: Do not advertise T3 permission modes that Pi does not enforce

- Evidence:
  - T3 UI promises supervised mode will ask before commands/file changes and auto-accept-edits will ask before other actions: `apps/web/src/components/chat/ChatComposer.tsx:135-147`.
  - Pi argv mapping only creates a static read-tool allowlist and appends `--approve`/`--no-approve`: `apps/server/src/provider/Layers/PiAdapter.ts:252-258`.
  - Upstream defines `--approve`/`--no-approve` as project-local resource trust, not tool approval: `/home/coder/.cache/checkouts/github.com/earendil-works/pi/packages/coding-agent/src/cli/args.ts:274-275`; parser is last-flag-wins at `args.ts:180-183`.
- Impact: supervised Pi is read-only rather than approval-driven. Auto-accept-edits leaves default command tools enabled, rather than prompting for them. A hidden `projectTrust` setting can override conflicting argv trust flags. The UI's security claims are false for Pi.
- Fix: either hide unsupported runtime modes for Pi or ship a Pi-side permission bridge that gates built-in/custom tool calls and maps decisions to T3 requests. Resolve project trust independently from runtime mode and emit one deterministic trust flag.
- Verification: command, file read, file change, extension/custom-tool, accept-for-session, reject-for-session, and project-local resource cases all match the displayed mode contract.

### P0-04: Emit user-input resolution after Pi extension UI response

- Evidence:
  - Pi maps `select`, `input`, and `editor` to `user-input.requested`: `apps/server/src/provider/Layers/PiAdapter.ts:1318-1340`.
  - `respondToUserInput` only writes `extension_ui_response`; it emits no `user-input.resolved`: `PiAdapter.ts:1656-1667`.
  - T3 derives open input count from `user-input.requested` minus `user-input.resolved`: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:145-161`; web session logic follows same rule at `apps/web/src/session-logic.ts:491-493`.
  - `pendingUiRequests` is written but never read or cleared: `PiAdapter.ts:1318`, `:1567`.
- Impact: Pi user-input requests remain pending in web/mobile timeline and projection after response. Stale request IDs are accepted and pending-map memory grows for long sessions.
- Fix: validate request ID/method using the pending map. After Pi accepts the response, delete it and publish `user-input.resolved` with normalized answers. Track confirm requests separately if T3 needs a provider-native resolution activity.
- Verification: select, input, editor, cancellation, unknown request ID, and response-write failure each produce correct pending-state transitions.

### P0-05: Make per-thread session replacement and failed sends atomic

- Evidence:
  - `startSession` creates a child scope and overwrites the thread key without stopping an existing same-adapter context: `apps/server/src/provider/Layers/PiAdapter.ts:1521-1601`.
  - `ProviderService.stopStaleSessionsForThread` intentionally skips the current adapter instance: `apps/server/src/provider/Layers/ProviderService.ts:487-516`; it cannot close the overwritten Pi process.
  - `sendTurn` sets `activeTurnId` and status `running` before attachment/RPC work at `PiAdapter.ts:1606-1619`; RPC request occurs later at `:1625-1631` with no rollback on failure.
- Impact: restarting/recovering a Pi thread on the same provider leaks an old child/event fiber that can emit stale events. A failed prompt/attachment read wedges a session as running, and subsequent user input becomes an invalid `steer`.
- Fix: serialize starts per thread; stop/await existing context before insertion; clean up a race loser. Commit turn state only after accepted prompt response, or restore previous state on failure.
- Verification: same-thread restart, concurrent starts, spawn failure, attachment read failure, and rejected prompt leave one process and coherent session state.

### P0-06: Inject T3 MCP server for Pi sessions

- Evidence:
  - Provider service issues a thread-bound MCP credential: `apps/server/src/provider/Layers/ProviderService.ts:217-227`.
  - Claude injects it into `mcpServers`: `apps/server/src/provider/Layers/ClaudeAdapter.ts:3442-3475`; OpenCode adds the remote server: `apps/server/src/provider/Layers/OpenCodeAdapter.ts:1057-1071`; Cursor/Grok also consume `McpProviderSession`.
  - Pi adapter has no `McpProviderSession` integration and only spawns Pi with generic args/environment: `apps/server/src/provider/Layers/PiAdapter.ts:1525-1531`.
- Impact: Pi lacks T3 MCP-backed features provided to all other supported agent runtimes, including server-integrated tools/preview automation.
- Fix: provision thread-specific T3 MCP config through owned Pi bridge/configuration, keeping authorization only in child environment/runtime memory and never session files or logs.
- Verification: Pi receives exactly one T3 MCP server per session, can invoke it, cannot reuse it after stop, and no credential appears in persisted session/event output.

### P1-07: Preserve terminal error/interrupt semantics

- Evidence:
  - Upstream assistant streams terminate with `error` carrying an `error` or `aborted` message: `/home/coder/.cache/checkouts/github.com/earendil-works/pi/packages/ai/src/types.ts:445-465`.
  - Pi mapper only handles `done`; errors fall through: `apps/server/src/provider/Layers/PiAdapter.ts:978-982`.
  - Process runtime emits exit code/signal: `apps/server/src/provider/piRpcRuntime.ts:108-120`; mapper always emits `exitKind: "graceful"`: `PiAdapter.ts:1372-1379`.
- Impact: cancelled/failed turns display as completed; non-zero process crashes display as clean stops; error diagnostics are lost.
- Fix: retain terminal-state fields in context, map stream errors and explicit aborts, and classify exit `error` unless deliberate clean shutdown/zero exit.
- Verification: abort, provider error, final retry failure, SIGTERM, and non-zero exit have correct session/turn status and user-visible diagnostics.

### P1-08: Wire or hide model/thinking/plan controls

- Evidence:
  - Pi declares in-session model switching unsupported and requires a new thread: `PiAdapter.ts:1520`; `apps/server/src/provider/Layers/PiProvider.ts:29-34`.
  - Existing Pi RPC supports `set_model` and `set_thinking_level`: `/home/coder/.cache/checkouts/github.com/earendil-works/pi/packages/coding-agent/docs/rpc.md:217-295`.
  - `sendTurn` only copies model text into local T3 state and sends prompt/steer; it does not call either command: `PiAdapter.ts:1611-1631`.
  - Pi provider exposes a T3 interaction-mode toggle but adapter never reads `interactionMode`: `PiProvider.ts:29-34`; `PiAdapter.ts:1603-1636`.
  - Pi hardcodes thinking options without upstream-supported `max`: `PiProvider.ts:42-49`.
- Impact: T3 advertises controls that are no-op or deliberately less capable than Pi/Codex. Model/thinking UI can diverge from the actual Pi session; plan mode does nothing.
- Fix: implement safe in-session model/thinking updates and update session state only after Pi accepts them. Add `max` where supported. Implement plan mode via the owned bridge or hide its toggle until supported.
- Verification: change model/thinking between turns, choose plan mode, and ensure UI/session state/running Pi state agree.

### P1-09: Restore standard provider observability and update-settings behavior

- Evidence:
  - Pi driver uses immutable snapshot settings and always performs maintenance enrichment: `apps/server/src/provider/Drivers/PiAgentDriver.ts:82-95`.
  - Existing drivers consume `ServerSettingsService`, honor `enableProviderUpdateChecks`, and pass native event loggers; for example `apps/server/src/provider/Drivers/GrokDriver.ts:87-135`.
  - Pi driver passes no native logger into its adapter: `PiAgentDriver.ts:72-76`.
- Impact: Pi ignores the global update-check toggle, does not react to snapshot-setting changes, and omits raw native RPC traces available for every other provider. Operational diagnosis and user privacy controls are inconsistent.
- Fix: adopt `makeProviderSnapshotSettingsSource`, pass update-check setting into maintenance enrichment, and wire `ProviderEventLoggers.native` through Pi adapter with best-effort raw RPC logging.
- Verification: toggling update checks stops future advisory lookup; native Pi events are written only when logging configured; logger failure cannot impact sessions.

### P1-10: Add lifecycle, protocol, and text-generation tests before further feature work

- Evidence:
  - `apps/server/src/provider/Layers/PiAdapter.test.ts` tests only pure event mapping; it never invokes adapter lifecycle methods.
  - No tracked `piRpcRuntime.test.ts` or `PiTextGeneration.test.ts` exists. Existing providers have text-generation test modules.
- Impact: protocol compatibility, child lifecycle, rollback, user input, process failure, model updates, MCP, and text generation have no regression protection. The broken private bridge was not detectable.
- Fix: inject/mock `PiRpcRuntimeShape` at adapter boundary, test captured upstream JSONL fixtures, and add contract tests against supported Pi version plus bridge version.
- Verification: tests cover all P0 findings and fail if supported RPC schema changes.

### P2-11: Finish product surface registration and documentation

- Evidence:
  - Shared display-name map omits Pi: `packages/contracts/src/model.ts:208-214`, though web update notifications fall back to raw driver slug.
  - Mobile provider icon only special-cases Claude and falls through to generic icon for Pi: `apps/mobile/src/components/ProviderIcon.ts:9-22`.
  - Root `README.md` and provider architecture documentation still list the prior provider set.
- Impact: Pi appears incomplete/inconsistent across desktop/web/mobile, and setup documentation does not establish required Pi/wrapper/bridge compatibility.
- Fix: centralize provider presentation metadata across web/mobile, add Pi display/icon tests, and document supported binary/bridge version, authentication, permissions, session storage, known capability limits, and recovery behavior.
- Verification: snapshot/provider-picker/update-notification/mobile icon docs tests cover Pi.

## Deliberately Not Reported As Bugs

- Pi supports native `follow_up`, manual compaction, session export, and other RPC commands not currently exposed by the generic T3 provider contract. They are direction opportunities, not failures of an existing T3 feature.
- Pi model discovery uses `get_available_models`, which upstream filters to configured authentication; current `authenticated` inference is therefore supported by code.
- Pi image inputs are schema-bounded to eight images of at most 10 MB each. The synchronous read is worth revisiting but is not a top audit finding.

## Recommended Execution Order

1. P0-01, P1-07, P0-05, and P1-10: establish correct lifecycle and tests first.
2. P0-02: choose supported bridge/versioning and define degraded capability behavior.
3. P0-03 and P0-04: make permissions and user-input semantics truthful.
4. P0-06: add MCP parity.
5. P1-08 and P1-09: control/operational parity.
6. P2-11: presentation and documentation.

## Verification Record

- `vp check`: passed with pre-existing 22 lint warnings in unrelated web/mobile files.
- `vp run --filter t3 typecheck`: passed.
- `vp run typecheck`: failed outside Pi scope in `infra/relay/src/agentActivity/apnsJwt.ts` because `@noble/curves/nist` and `@noble/hashes/sha2` cannot be resolved.
- `vp run --filter t3 test -- src/provider/Layers/PiAdapter.test.ts src/provider/Layers/PiProvider.test.ts`: test runner executed broader server suite; Pi tests passed within it, but unrelated failures occurred in `GrokAdapter.test.ts` and `GitVcsDriverCore.test.ts`.

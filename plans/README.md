# Advisor Artifacts

| File                                                     | Status                  | Scope                                   |
| -------------------------------------------------------- | ----------------------- | --------------------------------------- |
| [000-pi-agent-rpc-audit.md](./000-pi-agent-rpc-audit.md) | Remediation in progress | Pi Agent RPC integration at `0de374b28` |

This directory contains audit artifacts and remediation tracking.

Completed local remediation:

- Pi adapter/RPC/text-generation lifecycle fixes.
- Provider snapshot, presentation, update-settings, and native RPC logging parity.
- Regression coverage for public Pi RPC behavior.

Remaining design work:

- Owned Pi MCP bridge with per-thread T3 credentials.
- Pi-side permission bridge for supervised and auto-accept-edits modes.
- Provider setup and limitation documentation.

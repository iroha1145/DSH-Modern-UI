# Official-release web policy gate

**Status: blocked on official `@deepseek-ai/dsh@0.2.1-rc.4`. Do not migrate legacy `web/search` data to the experimental plugin record.**

The official SDK CLI profile resumes a session with a recorded, unavailable agent preset and executes a counted web tool. The normal Web and headless profiles refuse the same unavailable preset. Checking only those two profiles therefore gives a false assurance.

## Reproduce in a clean consumer

Use Node **24.22.1** and a separate directory outside this checkout. The official runtime must be installed there through npm; do not link an upstream checkout. For example, initialize that directory with `npm init -y`, then run `npm install --save-exact @deepseek-ai/dsh@0.2.1-rc.4`. Normal official installation and its native lifecycle scripts are a separate platform acceptance concern; this compatibility runner does not certify zero-compilation installation.

Then one command performs the probes:

```text
node <checkout>/scripts/compatibility/run-policy-gate.mjs <consumer-directory>
```

The runner requires the npm CLI bundled beside that Node installation. It packs the experimental policy from this repository, installs the actual tarball into the consumer, copies the committed mock fixture automatically, and creates a fresh `policy-gate-*` directory. All DSH homes, sessions, mock counters, package-manager cache and result files belong to that consumer. No real user DSH home is read or migrated. The runner launches the official Web profile on loopback and removes startup authentication tokens from saved logs.

An exit code of zero means **the asserted counterexamples reproduced**, not that the safety gate passed. Read `gate-summary.json`: its result is `blocked`. The runner leaves the experimental policy package uninstalled after checking removal. A later run can pack and install it again. Do not use this runner as a production migration or installer.

Important outputs inside the fresh directory:

- `steps.json`: exit codes and sanitized CLI output for every stage.
- `controls/probe-result.json`: required-event rejection and tools restriction controls.
- `owned/owned-policy.export.jsonl`: canonical export produced by the official `readSessionLogText` and checked against `serializeSessionLog`.
- `owned/sdk-*-result.json`: real JSON-RPC frames, model visibility, counted tool execution and official-file hash comparison.
- `owned/official-files.sha256.json`: SHA256 inventory of every file under the consumer's `node_modules/@deepseek-ai`.

The fixture at `tests/compatibility/fixtures/counted-web-mock.mjs` supplies a model that deliberately requests `web_search`, even if it is not advertised. Its tool body only writes a local count; it does not access the network. The official registry and agent loop decide whether that body executes.

## Tested outcomes

Observed on Windows x64, Node 24.22.1, bundled npm 11.19.1, official npm DSH 0.2.1-rc.4:

- `web/search` is absent from the published known-event set. A real JSONL write handle accepts the event, but opening/reading that durable log refuses the unknown required event. No validator was changed.
- Replacing it with an unbound `plugin:...` record is unsafe: a restarted official agent sees `web_search` and runs it once without the policy.
- A preset whose policy row is disabled still mounts; a preset name alone does not prove the required policy is active.
- The real `tools.restrict` positive control hides `web_search` and rejects a forced call with `UNKNOWN_TOOL`; the counted body runs zero times.
- The packaged owned-preset prototype registers `iroha-modern-ui-web-policy-v1` and automatically adds the policy as part of its definition. `/web off` settles durably. A real Web-profile restart restores `{enabled:false,pending:false}`, hides web tools and rejects the forced mock call.
- Removing the owning plugin from the ordinary Web composition, or setting its row to `disabled: true`, refuses resume with `Unknown agent preset`.
- Direct official headless CLI access refuses the preset-bound session with `one-shot runner does not compose` and exits 1.
- Direct official **SDK CLI** access, without Modern UI or the policy plugin, accepts `initialize`, `session/resume`, `session/prompt`, and `session/wait`. `web_search` is advertised and its body runs **once**.
- The same SDK bypass occurs for the public-storage-API copy and for a copy made from the official canonical JSONL export. The preset header and every event are retained. The source is compared before and after copying and remains unchanged.
- An actual npm uninstall of the policy package preserves the Web refusal but does not stop the SDK bypass.
- During the SDK scenarios, **42,722 official files** have identical SHA256 hashes before and after execution. The experiment does not modify official backend files or event validators.

The export claim is deliberately narrow: official canonical JSONL export plus import through public persistence APIs. This is **not** a test of the browser's ZIP download/import UI, attachment archives, or descendant-archive restoration.

## Why the owned preset is still insufficient

The published `@deepseek-ai/dsh-sdk-jsonrpc-server` root export exposes `HarnessSdkJsonRpcServer`. Its `createSession` resume branch calls `ctx.agents.resume({ resumeSessionId, agentOptions })` directly. It does not resolve or mount the session's recorded agent preset. The core resume boundary also does not require that composition. The ordinary `sdk` profile composes this official server, so this is a supported CLI path, not an injected replacement server or private-module access.

The prototype's log representation is intentionally retained only for research:

- Header preset: `iroha-modern-ui-web-policy-v1`.
- Committed state: `plugin:iroha-modern-ui/web-search-v1`, `{enabled:boolean}`.
- Pending state: original `command/run` and successful `command/done` settlement order.
- Client projection: `webSearch`, `{enabled,pending}`; command: `/web on|off`.

No legacy session may be converted to this representation while the SDK bypass exists. A backup of the original event would not make the converted session safe.

## Bounded interface review

The review inspected the actual published package exports and declarations, plus the corresponding published JS for the session, agent, tools, preset registry, SDK server, sandbox, approval and permission-preset packages. It did not infer support from unpublished upstream code.

- `SessionHeader` has a recorded `agentPreset`, but no exported mandatory-capability or immutable tool-deny metadata contract.
- Required event recognition is a build-static set. The supported experimental record API writes ignorable `plugin:` records. Adding names to the exported set in memory would be a prohibited monkey patch.
- `tools.restrict` and `tools.guard` are scoped runtime effects. They are useful while their owning composition exists; they do not independently persist an enforceable requirement into all future profiles.
- `sandbox/mode` is file/shell sandbox state interpreted by the sandbox-policy service. It is not a per-session web-tool deny list.
- `approval/policy` has `ask` and `never`; `never` rejects operations that actually request approval. The published web tool does not request approval, so this cannot express the old web switch.
- `permission/preset` bundles those sandbox and approval knobs. Its published `PresetSpec` contains no tool-name/prefix denial contract.

These are the searched interfaces, not a claim that no future official extension can solve the problem.

## Upstream capability needed

At minimum the SDK resume path must refuse a preset-bound session when it cannot reconstruct that preset, matching headless behavior. Prefer enforcing required composition at the common agent/session resume boundary so each surface cannot accidentally omit it. A supported required-capability/mandatory-policy contract must survive persistence, exact historical forks and export/import, and fail before model/tool execution when the capability is missing. Once such a release is published, rerun this gate before implementing a legacy converter.

The experimental package is private and is not part of the production bundle. Full command concurrency/cancellation, historical forks, subagent inheritance, all MCP prefixes and live generation removal are **not accepted** as feature-equivalent: the SDK counterexample failed the earlier hard gate, so further production-policy development stopped. The old patch's default scope remains `web_search`, `web_fetch`, and prefixes `mcp__exa__`, `mcp__tavily`, `mcp__brave`, `mcp__perplexity`, `mcp__firecrawl`, `mcp__fetch__`, `mcp__jina`; it is not a network firewall.

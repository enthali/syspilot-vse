# AHP (Agent Host Protocol) — Research Findings

> **Date:** 2026-05-13 (evening session, after S2S MCP bridge proven)  
> **Status:** Research only. No production decision yet — discuss tomorrow.  
> **Context:** Followed up on the discovery of `code --agents` flag and `code agent` subcommand. Goal: understand if AHP is a cleaner channel than ACP-over-stdin for our S2S architecture.

---

## TL;DR (read this first)

**AHP is a real, well-structured WebSocket JSON-RPC protocol shipping with VS Code today.** It's how the Agents Window will talk to **remote** agent hosts (SSH, tunnels, your laptop as a server).

**But for our specific S2S use case, AHP does NOT replace ACP.** Reasons:

1. AHP servers are **isolated agent host instances**. A fresh `code agent host` does NOT see the user's existing local Copilot CLI sessions (those live in the Agents Window's own internal host).
2. There's no documented way to point AHP at the existing `~/.copilot/session-state/` session pool.
3. ACP-over-stdin (what we already have working) is *purpose-built* for "inject into an existing on-disk session" — exactly what we want.

**However, AHP is genuinely useful for syspilot in a different mode** — see "Where AHP fits" at the end.

---

## What is AHP?

The Agent Host Protocol is the wire format between the VS Code Agents Window (and its `code agent ps/logs/stop` CLI tools) and a running **agent host server**. The server in turn manages multiple chat sessions backed by Copilot CLI / Claude / Cloud agents.

Architecture:

```
┌──────────────────────┐    AHP    ┌─────────────────────┐
│ Agents Window (or    │ ───WS───▶ │ Agent Host Server   │
│ `code agent ps`)     │           │ (downloaded server  │
└──────────────────────┘           │  build, runs Node)  │
                                    │                     │
                                    │  ┌───────────────┐  │
                                    │  │ Session Pool  │  │
                                    │  │ - copilotcli  │  │
                                    │  │ - claude      │  │
                                    │  │ - copilot-    │  │
                                    │  │   cloud-agent │  │
                                    │  └───────────────┘  │
                                    └─────────────────────┘
```

## How to start an AHP server

```powershell
code agent host --port 31416 --without-connection-token --log debug
```

Options that matter:
- `--port 0` → pick random free port
- `--connection-token <secret>` or `--connection-token-file <path>` → auth shared secret in URL: `ws://127.0.0.1:1234?tkn=<secret>`
- `--without-connection-token` → only safe behind localhost firewall
- `--server-data-dir <dir>` → where the host stores its state (ISOLATED from user's main `~/.copilot`)
- `--tunnel` → expose via VS Code dev tunnel for remote access

The server is the same Node-based server build VS Code uses for tunnels. It downloads to `~/.vscode/cli/servers/Stable-<commit>/server` on first run (~500 MB extracted).

## CLI surface VS Code already provides

```
code agent host    # Start a local agent host server
code agent ps      # List active sessions on a running host
code agent stop    # Cancel the active turn of a session
code agent kill    # Force kill the agent host process tree
code agent logs    # Stream live session events for one session
```

`code agent ps` / `stop` / `logs` auto-discover a locally running host. Use `--address ws://...` to pin a specific one. `--tunnel <name>` to reach a remote one.

## Wire format

WebSocket carrying **JSON-RPC 2.0**, protocol version `0.1.0`.

### Handshake

Client → server:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {
    "protocolVersions": ["0.1.0"],
    "clientId": "<uuid>",
    "initialSubscriptions": ["agenthost:/root"]
  }
}
```

Server response includes a snapshot of every subscribed resource. The root snapshot tells you the available agent providers, current `activeSessions` count, full `config` schema, etc.

### Authentication

```json
{
  "jsonrpc": "2.0", "id": "2",
  "method": "authenticate",
  "params": {
    "resource": "https://api.github.com",
    "token": "<github-oauth-token>"
  }
}
```

Without authentication, `listSessions` returns `-32007 "Authentication is required to use Copilot"`.

A token from `gh auth token` works (proven empirically tonight).

### Request methods (client → server)

Discovered from `sessions.desktop.main.js`:

| Method | Params |
|---|---|
| `initialize` | `{ protocolVersions, clientId, initialSubscriptions }` |
| `authenticate` | `{ resource, token }` |
| `subscribe` | `{ resource: "<uri>" }` — adds a resource subscription, get snapshot back |
| `listSessions` | `{}` — returns `{ items: [...] }` |
| `createSession` | `{ session, provider, model?, workingDirectory?, config?, activeClient? }` |
| `disposeSession` | `{ session }` |
| `resolveSessionConfig` | session config defaults |
| `sessionConfigCompletions` | autocomplete in config UI |
| `completions` | autocomplete inside chat input |
| `resourceList` | `{ uri }` — list children |
| `resourceRead` | `{ uri }` |
| `resourceWrite` | `{ uri, contents }` |
| `resourceCopy` / `resourceMove` / `resourceDelete` | filesystem ops |
| `createTerminal` / `disposeTerminal` | per-session terminal |
| `shutdown` | clean shutdown (extension-only call) |

### Notification methods (client → server)

- `dispatchAction` — fire-and-forget action against a subscribed resource (e.g. send a message to a session)
- `unsubscribe`

### Notification methods (server → client) — full list

These are pushed when a subscribed resource changes. They are how you get streaming output:

```
session/turnStarted          session/turnComplete         session/turnCancelled
session/responsePart         session/delta                session/reasoning
session/toolCallStart        session/toolCallReady        session/toolCallDelta
session/toolCallContentChanged    session/toolCallConfirmed    session/toolCallComplete
session/toolCallResultConfirmed
session/inputRequested       session/inputAnswerChanged   session/inputCompleted
session/pendingMessageSet    session/pendingMessageRemoved    session/queuedMessagesReordered
session/activeClientChanged  session/activeClientToolsChanged    session/serverToolsChanged
session/customizationsChanged    session/customizationToggled
session/configChanged        session/modelChanged         session/metaChanged
session/titleChanged         session/activityChanged      session/usage
session/diffsChanged         session/isReadChanged        session/isArchivedChanged
session/ready                session/creationFailed       session/error
session/truncated
```

This is essentially the live event stream we wanted to tail (today we read events.jsonl directly).

## Sending a prompt — TODO

We could not 100% confirm tonight which `dispatchAction` shape sends a fresh user prompt and starts a turn. Candidates seen in the client code:

- `{ type: "session/pendingMessageSet", session, kind: "queued"|"steering", id, userMessage: { text, attachments } }` — adds to queue or steers active turn
- The actual "submit and start turn" might be a separate dispatchAction we haven't found

Tomorrow: capture wire traffic from the real Agents Window (point a proxy at it, or use the `ahpJsonlLoggingEnabled` config below).

## Useful settings discovered

```jsonc
{
  "chat.agentHost.enabled": true,                  // enable agent host integration
  "chat.agentHost.ipcLoggingEnabled": true,        // log IPC traffic
  "chat.agentHost.ahpJsonlLoggingEnabled": true,   // log full AHP JSONL — golden for protocol learning
  "chat.agentHost.localFilePermissions": "...",
  "chat.agentHost.claudeAgent.path": "..."         // path to claude binary
}
```

**Action item:** turn on `ahpJsonlLoggingEnabled`, drive the Agents Window normally, and we get the complete protocol transcript in a log file. This will confirm the prompt-send shape.

## Where AHP fits in our S2S architecture

### Where AHP is the WRONG tool

- **Talking to existing user sessions in `~/.copilot/session-state/`** — those live inside the Agents Window's own internal host, which doesn't expose AHP externally. Stick with **ACP-over-stdin** (what we already have working).
- **Quick prompt injection** — ACP is one process spawn + 3 JSON messages. AHP requires running a server, auth, subscribing.

### Where AHP is the RIGHT tool

1. **Headless agent fleets**: if syspilot wants to run a Project Manager + Code Manager + N subagents *as remote agent hosts* (not in the user's chat window), AHP is the orchestration protocol. Each agent gets its own session, AHP controls them.
2. **Cross-machine syspilot**: run `code agent host --tunnel` on a beefy server, point your laptop's Agents Window at it, all your agents live remote. AHP makes this transparent.
3. **Live event tailing**: AHP's `session/*` notifications are richer than `events.jsonl` (tool call confirmations, pending message kinds, etc). If we want a *real-time* chord/inbox UI, subscribing via AHP gives us streaming updates without filesystem polling.
4. **Multi-agent coordinator**: one AHP server hosting all syspilot agents. The PM uses `dispatchAction` to talk to peer agents; subscriptions push completions back.

### Recommendation for tomorrow's discussion

Two-track strategy:

| Track | Layer | Status |
|---|---|---|
| **A: ACP injection** | Talk to user's existing local sessions (Alice, Bob, sub-managers) in their Agents Window | ✅ Working |
| **B: AHP fleet** | Spin up a dedicated `code agent host` for syspilot's headless agents (workers, designer, QM) — long-lived, queryable, streamable | 🔬 Proven feasible, not built |

Track A keeps the user-visible chat sessions interactive. Track B gives us a clean, queryable "agent farm" for the autonomous worker pool. They're complementary, not competing.

Concretely for the syspilot vision (PM + CM + QM + N subagents):
- PM / CM / QM = Track A (user sees them, occasionally pings them)
- Subagents (designer, code-writer, test-runner) = Track B (live in our private agent host, AHP-controlled, never clutter the user's session list)

## Files to look at tomorrow

- Server: `C:\Users\georgdoll\.vscode\cli\servers\Stable-0958016b2af9f09bb4257e0df4a95e2f90590f9f\server\out\vs\platform\agentHost\node\agentHostMain.js`
- Client: `C:\Users\georgdoll\AppData\Local\Programs\Microsoft VS Code\0958016b2a\resources\app\out\vs\sessions\sessions.desktop.main.js`
- Probe scripts: `~/.copilot/session-state/<this-session>/files/ahp_probe.js` and `ahp_probe2.js`

## Open questions

1. What's the exact `dispatchAction` shape to send a prompt + start a turn? (Capture via `ahpJsonlLoggingEnabled`.)
2. Can a `code agent host` be configured to read sessions from `~/.copilot/session-state/`, or are session pools strictly per-host?
3. Does `code agent host --tunnel` give a stable address we can register with the Agents Window UI for remote use?
4. AHP `subscribe(resource: "<sessionUri>")` would replace `events.jsonl` polling — same data?
5. Is there a way besides `copilotcli` / `claude` / `cloud` providers? Could syspilot register itself as a custom provider?

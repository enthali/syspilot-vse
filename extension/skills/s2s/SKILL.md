---
name: s2s
description: >
  Session-to-Session (S2S) messaging for Copilot CLI agents. Use this skill
  whenever you need to send a message to another agent session, check your
  inbox, receive a pending message, or list active sessions. Triggers include:
  "send to session", "check inbox", "receive message", "message agent",
  "notify session", "S2S", "session-to-session", or any request to communicate
  with another named Copilot CLI session.
---

# S2S — Session-to-Session Messaging

S2S lets Copilot CLI sessions exchange messages via a file-backed inbox.
Each session has a FIFO inbox. Messages are delivered by writing to the
receiver's inbox file. A `send --notify` call also injects a prompt into
the receiver via ACP so it processes the message immediately.

The engine lives at `C:\workspace\syspilot-vse\extension\engine\cli.js`
(Node.js, stdlib only — no install needed).

---

## Your Session Identity

Every agent session must know its own name to receive messages. Your name
was usually given to you in your opening prompt (e.g. "you are alice").

**Validate your identity before sending or receiving:**

1. Recall the name you were given. If you don't know it, **ask the user**:
   _"What is my session name for S2S messaging?"_ — do not guess.
2. Verify the name appears in the session list:

   ```powershell
   node C:\workspace\syspilot-vse\extension\engine\cli.js list
   ```

3. If your name is not in the list, ask the user to confirm or correct it.
   Do not proceed with `send`/`receive` until your identity is confirmed.

Once confirmed, use that name as `--from` (when sending) and `--session`
(when receiving/peeking) for the rest of the conversation.

---

## Commands

All commands output JSON.

### List sessions in the current workspace

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js list
```

Add `--all-workspaces` to see sessions across all workspaces.

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js list --all-workspaces
```

Output fields per session: `uuid`, `name`, `cwd`, `repository`, `branch`,
`inboxDepth` (pending messages), `locked` (bool — session is active).

---

### Send a message

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js send `
  --to <name-or-uuid> `
  --text "your message here" `
  --from <your-session-name>
```

Add `--notify` to also inject a prompt into the receiver via ACP (the
receiver will immediately process the message). Only use `--notify` when
the target session is **not** currently locked (check `locked` field from
`list`). Sending to a locked session without `--notify` is safe — message
queues and waits.

```powershell
# Send with ACP notification (target must be idle)
node C:\workspace\syspilot-vse\extension\engine\cli.js send `
  --to bob `
  --from alice `
  --text "Review PR #42 and report back" `
  --notify
```

Output: `{ "id": "<uuid>", "to": "<uuid>", "queued": true, "notified": false|true }`

---

### Check inbox depth (non-destructive)

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js peek --session <your-name>
```

Output: `{ "depth": 2, "next": { "id": "...", "from": "alice", "text": "...", "ts": "..." } }`

Returns `null` for `next` when inbox is empty.

---

### Receive (pop) the next message

Removes and returns the oldest message from your inbox (FIFO).

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js receive --session <your-name>
```

Output: `{ "id": "...", "from": "alice", "text": "...", "ts": "..." }`
Returns `null` when inbox is empty.

Call `receive` in a loop until `null` to drain the full inbox:

```powershell
do {
  $msg = node C:\workspace\syspilot-vse\extension\engine\cli.js receive --session <your-name> | ConvertFrom-Json
  if ($msg) { Write-Host "FROM $($msg.from): $($msg.text)" }
} while ($msg)
```

---

## Typical Workflows

### Agent start-of-turn inbox check

At the start of each turn, check if you have pending messages:

```powershell
$next = node C:\workspace\syspilot-vse\extension\engine\cli.js peek --session <your-name> | ConvertFrom-Json
if ($next.depth -gt 0) {
  Write-Host "You have $($next.depth) message(s). Next from: $($next.next.from)"
}
```

Then drain and process:

```powershell
do {
  $msg = node C:\workspace\syspilot-vse\extension\engine\cli.js receive --session <your-name> | ConvertFrom-Json
  if ($msg) {
    # process $msg.text from $msg.from
  }
} while ($msg)
```

### Fan-out: send tasks to multiple agents

```powershell
@("designer", "reviewer", "tester") | ForEach-Object {
  node C:\workspace\syspilot-vse\extension\engine\cli.js send `
    --to $_ --from pm --text "Start sprint-7 tasks"
}
```

### Send a reply

```powershell
node C:\workspace\syspilot-vse\extension\engine\cli.js send `
  --to $msg.from `
  --from <your-name> `
  --text "Done. PR #42 reviewed — 3 issues found, see session notes."
```

---

## Audit Log

Every send and receive is appended to `.s2s/log.jsonl` in the workspace
root. Two event types:

```json
{ "event": "send",    "id": "...", "from": "alice", "to": "bob",   "text": "...", "ts": "..." }
{ "event": "receive", "id": "...", "by": "bob",                                   "ts": "..." }
```

To inspect the log:

```powershell
Get-Content .s2s\log.jsonl | ConvertFrom-Json
```

---

## Important Rules

1. **Never send to a locked session with `--notify`** — check `locked` from
   `list` first. Sending without `--notify` is always safe.
2. **Always pass `--from`** — receivers need to know who sent the message.
3. **Your name is your identity** — resolve ambiguity by UUID if two
   sessions share a name.
4. **`receive` is destructive** — it pops the message. Use `peek` first
   if you only want to look.
5. **Workspace scoping** — by default only sessions in the same workspace
   (matching `cwd`) are visible. Use `--all-workspaces` for cross-project.

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

## Prerequisites

- **Node.js** must be installed and on `PATH` (`node --version` works).
- The CLI lives next to this skill at `engine/cli.js` and uses only Node
  stdlib — no `npm install` needed.

## CLI invocation

All commands use the bundled engine. Pick the form that works in your shell:

```bash
# POSIX (bash, zsh, fish)
node ~/.copilot/skills/s2s/engine/cli.js <command> ...
```

```powershell
# PowerShell (Windows / cross-platform)
node "$env:USERPROFILE\.copilot\skills\s2s\engine\cli.js" <command> ...
```

For brevity, examples below use the POSIX form. Substitute the PowerShell
form on Windows if you are not in a POSIX shell. All commands output JSON.

---

## Your Session Identity

Every agent session must know its own name to receive messages. Your name
was usually given to you in your opening prompt (e.g. "you are alice").

**Validate your identity before sending or receiving:**

1. Recall the name you were given. If you don't know it, **ask the user**:
   _"What is my session name for S2S messaging?"_ — do not guess.
2. Verify the name appears in the session list:

   ```bash
   node ~/.copilot/skills/s2s/engine/cli.js list
   ```

3. If your name is not in the list, ask the user to confirm or correct it.
   Do not proceed with `send`/`receive` until your identity is confirmed.

Once confirmed, use that name as `--from` (when sending) and `--session`
(when receiving/peeking) for the rest of the conversation.

---

## Commands

### List sessions in the current workspace

```bash
node ~/.copilot/skills/s2s/engine/cli.js list
```

Add `--all-workspaces` to see sessions across all workspaces:

```bash
node ~/.copilot/skills/s2s/engine/cli.js list --all-workspaces
```

Output fields per session: `uuid`, `name`, `cwd`, `repository`, `branch`,
`inboxDepth` (pending messages).

---

### Send a message

```bash
node ~/.copilot/skills/s2s/engine/cli.js send \
  --to <name-or-uuid> \
  --from <your-session-name> \
  --text "your message here"
```

Add `--notify` to also inject a prompt into the receiver via ACP (the
receiver will immediately process the message). Sending without `--notify`
is always safe — the message queues until the receiver next checks its
inbox. Only use `--notify` when the target session is currently idle.

Output: `{ "id": "<uuid>", "to": "<uuid>", "queued": true, "notified": false|true }`

---

### Check inbox depth (non-destructive)

```bash
node ~/.copilot/skills/s2s/engine/cli.js peek --session <your-name>
```

Output: `{ "depth": 2, "next": { "id": "...", "from": "alice", "text": "...", "ts": "..." } }`

Returns `null` for `next` when inbox is empty.

---

### Receive (pop) the next message

Removes and returns the oldest message from your inbox (FIFO).

```bash
node ~/.copilot/skills/s2s/engine/cli.js receive --session <your-name>
```

Output: `{ "id": "...", "from": "alice", "text": "...", "ts": "..." }`
Returns `null` when inbox is empty.

To drain the full inbox, call `receive` in a loop until it returns `null`.

---

## Typical Workflows

### Start-of-turn inbox check

At the start of each turn, peek to see if anything is waiting:

```bash
node ~/.copilot/skills/s2s/engine/cli.js peek --session <your-name>
```

If `depth > 0`, drain by repeatedly calling `receive` until it returns
`null`, processing each message in order.

### Fan-out: send tasks to multiple agents

Loop over recipients in your shell of choice and call `send` per target.

### Send a reply

Use the `from` field of the received message as the new `--to`:

```bash
node ~/.copilot/skills/s2s/engine/cli.js send \
  --to <message.from> \
  --from <your-name> \
  --text "Done. PR #42 reviewed — 3 issues found."
```

---

## Audit Log

Every send and receive is appended to `.s2s/log.jsonl` in the workspace
root. Two event types:

```json
{ "event": "send",    "id": "...", "from": "alice", "to": "bob", "text": "...", "ts": "..." }
{ "event": "receive", "id": "...", "by": "bob",                                 "ts": "..." }
```

The `id` field links a `receive` back to its original `send`.

---

## Important Rules

1. **Only `--notify` an idle session.** Notifying a busy session can
   interrupt its current turn. Sending without `--notify` is always safe.
2. **Always pass `--from`** — receivers need to know who sent the message.
3. **Your name is your identity.** If two sessions share a name in the
   same workspace, resolve ambiguity by passing the UUID instead.
4. **`receive` is destructive** — it pops the message. Use `peek` first
   if you only want to look.
5. **Workspace scoping** — by default only sessions in the current
   workspace are visible to `list`. Use `--all-workspaces` for cross-
   project routing. UUID lookups always work regardless of workspace.

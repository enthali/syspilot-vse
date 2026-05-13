# S2S Prototype Extension

Minimal sideloaded VS Code extension to verify that we can run our own
extension inside the Agents Window.

## Install (sideload as symlink)

Run **as Administrator** in a PowerShell:

```powershell
$src = "C:\workspace\syspilot-vse\extension"
$dst = "$env:USERPROFILE\.vscode\extensions\syspilot.s2s-prototype-0.0.1"
New-Item -ItemType SymbolicLink -Path $dst -Target $src
```

(Or just copy the folder if you don't want to deal with symlinks:
`Copy-Item -Recurse $src $dst`)

Then **fully quit and restart VS Code** (all windows).

## Opt in to the Agents Window

In your User `settings.json`:

```json
"extensions.supportAgentsWindow": {
  "syspilot.s2s-prototype": true
}
```

Reload / restart again.

## Verify

1. Open the Agents Window (`code --agents` or title-bar button).
2. Open Command Palette (Ctrl+Shift+P).
3. Search for `S2S:` — you should see `S2S: Hello (test)` and
   `S2S: Open Browser (test)`.
4. Run `S2S: Hello` → notification should pop up saying which app it ran in.
5. Run `S2S: Open Browser` → enter a URL → integrated browser opens in
   the Agents Window.

## Generic command bridge

Use `S2S: Run VS Command` to execute any VS Code command id with optional JSON
arguments.

Equivalent command ids (same handler):

- `s2s.vsCommand`
- `syspilot.s2s.vsCommand`

Examples:

- Command id: `workbench.action.chat.openNewSessionEditor.copilotcli`
- Args JSON: `"0eb3c79a-23ff-437b-938e-676825ba9c18"`

- Command id: `workbench.action.chat.openSessionWithPrompt.copilotcli`
- Args JSON: `[{"sessionId":"0eb3c79a-23ff-437b-938e-676825ba9c18"}]`

Programmatic invocation from other extensions/tools:

```js
await vscode.commands.executeCommand('s2s.vsCommand', {
  commandId: 'workbench.action.chat.openNewSessionEditor.copilotcli',
  args: ['0eb3c79a-23ff-437b-938e-676825ba9c18']
});
```

Also check the **Output panel → channel "S2S Prototype"** for activation
log lines (which `appName`, sessionId, workspace folders).

## Discoveries (end of day 2026-05-13)

VS Code CLI has a hidden `--agents` flag and a full `agent` subcommand:

```
code --agents              # Opens the Agents Window
code agent host            # Start a local agent host server (HTTP REST API)
code agent ps              # List active sessions on a running agent host
code agent stop            # Cancel the active turn of a session
code agent kill            # Force kill the agent host process tree
code agent logs            # Stream live session events
```

This is the **AHP (Agent Host Protocol)** machinery exposed as a CLI tool.
Likely a second, cleaner channel than ACP-via-stdin for everything we want:
inject prompts, list/stop sessions, tail event streams.

Investigate next session: does `code agent host` give us a JSON REST API
that bypasses the lock-file dance entirely?

// S2S prototype extension.
// Proves: sideloaded extension running in the Agents Window can execute
// VS Code commands to navigate sessions and control UI.

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mcp = require('./mcpServer');

const MCP_PORT = 31415;

function deployBundledSkills(channel) {
  const srcRoot = path.join(__dirname, 'skills');
  const dstRoot = path.join(os.homedir(), '.copilot', 'skills');
  if (!fs.existsSync(srcRoot)) {
    channel.appendLine('[skills] no bundled skills folder, skipping');
    return;
  }
  for (const name of fs.readdirSync(srcRoot)) {
    const srcDir = path.join(srcRoot, name);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const dstDir = path.join(dstRoot, name);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      const srcFile = path.join(srcDir, file);
      const dstFile = path.join(dstDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, dstFile);
      }
    }
    channel.appendLine(`[skills] deployed: ${name} -> ${dstDir}`);
  }
}

// Hardcoded sessions for initial proof-of-concept.
const SESSIONS = {
  'acp-lab-alice': '0eb3c79a-23ff-437b-938e-676825ba9c18',
  'acp-lab-bob':   'fda5283d-f8d8-46bc-bc6d-51ab5c4fd0bb',
};

// Commands discovered via s2s.discoverCommands — ordered by most likely to work.
const GOTO_CANDIDATES = [
  'workbench.action.chat.openSessionWithPrompt.copilotcli',
  'workbench.action.chat.openNewSessionEditor.copilotcli',
  'workbench.action.chat.openNewSessionSidebar.copilotcli',
];

function normalizeArgs(args) {
  if (args === undefined || args === null) return [];
  return Array.isArray(args) ? args : [args];
}

function summarize(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function executeVsCommand({ commandId, args = [] }, channel) {
  if (!commandId || typeof commandId !== 'string') {
    throw new Error('commandId is required');
  }

  const argList = normalizeArgs(args);
  channel.appendLine(`[vsCommand] invoke: ${commandId} args=${summarize(argList)}`);

  const started = Date.now();
  const result = await vscode.commands.executeCommand(commandId, ...argList);
  const elapsedMs = Date.now() - started;

  channel.appendLine(`[vsCommand] success: ${commandId} (${elapsedMs}ms) result=${summarize(result)}`);
  return result;
}

async function tryGotoSession(sessionId, channel) {
  for (const cmd of GOTO_CANDIDATES) {
    const payloads = [
      [sessionId],
      [{ sessionId }],
      [{ id: sessionId }],
      [{ session: { id: sessionId } }],
    ];

    let succeeded = false;
    for (const payload of payloads) {
      try {
        await executeVsCommand({ commandId: cmd, args: payload }, channel);
        channel.appendLine(`[goto] success with command: ${cmd} payload=${summarize(payload)}`);
        succeeded = true;
        break;
      } catch (e) {
        channel.appendLine(`[goto] ${cmd} payload=${summarize(payload)} failed: ${e.message}`);
      }
    }

    if (succeeded) {
      return cmd;
    }

    try {
      // Keep one final explicit attempt to preserve previous behavior.
      await vscode.commands.executeCommand(cmd, sessionId);
      channel.appendLine(`[goto] success with command: ${cmd} sessionId: ${sessionId}`);
      return cmd;
    } catch (e) {
      channel.appendLine(`[goto] ${cmd} failed: ${e.message}`);
    }
  }
  return null;
}

function activate(context) {
  const channel = vscode.window.createOutputChannel('S2S');
  channel.appendLine(`[activate] loaded at ${new Date().toISOString()}`);
  channel.appendLine(`[activate] appName: ${vscode.env.appName}`);
  channel.appendLine(`[activate] sessionId: ${vscode.env.sessionId}`);

  try {
    deployBundledSkills(channel);
  } catch (e) {
    channel.appendLine(`[skills] deploy failed: ${e.message}`);
  }

  const runVsCommandHandler = async (input) => {
      channel.appendLine('[s2s.vsCommand] invoked');
      channel.show(true);

      let commandId = null;
      let args = [];

      if (typeof input === 'string') {
        commandId = input;
      } else if (input && typeof input === 'object') {
        commandId = input.commandId || input.command || null;
        args = normalizeArgs(input.args);
      }

      if (!commandId) {
        commandId = await vscode.window.showInputBox({
          prompt: 'VS Code command id to execute',
          value: 'workbench.action.chat.openNewSessionEditor.copilotcli'
        });
      }
      if (!commandId) return;

      if (args.length === 0) {
        const rawArgs = await vscode.window.showInputBox({
          prompt: 'Optional JSON args (array or scalar). Leave empty for no args.',
          value: ''
        });

        if (rawArgs && rawArgs.trim()) {
          try {
            args = normalizeArgs(JSON.parse(rawArgs));
          } catch (e) {
            vscode.window.showErrorMessage(`Invalid JSON args: ${e.message}`);
            return;
          }
        }
      }

      try {
        const result = await executeVsCommand({ commandId, args }, channel);
        vscode.window.showInformationMessage(`Executed: ${commandId}`);
        return result;
      } catch (e) {
        vscode.window.showErrorMessage(`Command failed: ${commandId} — ${e.message}`);
        throw e;
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.vsCommand', runVsCommandHandler)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('syspilot.s2s.vsCommand', runVsCommandHandler)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.hello', async () => {
      await vscode.window.showInformationMessage(
        `S2S alive in: ${vscode.env.appName}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.openBrowser', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'URL to open in integrated browser',
        value: 'https://example.com'
      });
      if (!url) return;
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', url);
      } catch (e) {
        vscode.window.showErrorMessage(`Browser open failed: ${e}`);
      }
    })
  );

  // Goto hardcoded sessions
  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.gotoAlice', async () => {
      channel.appendLine('[s2s.gotoAlice] invoked');
      channel.show(true);
      const used = await tryGotoSession(SESSIONS['acp-lab-alice'], channel);
      if (used) {
        vscode.window.showInformationMessage(`Navigated to acp-lab-alice (via ${used})`);
      } else {
        vscode.window.showWarningMessage(`Could not navigate to acp-lab-alice — see S2S output for candidates tried`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.gotoBob', async () => {
      channel.appendLine('[s2s.gotoBob] invoked');
      channel.show(true);
      const used = await tryGotoSession(SESSIONS['acp-lab-bob'], channel);
      if (used) {
        vscode.window.showInformationMessage(`Navigated to acp-lab-bob (via ${used})`);
      } else {
        vscode.window.showWarningMessage(`Could not navigate to acp-lab-bob — see S2S output for candidates tried`);
      }
    })
  );

  // ---- MCP server tools (back door for CLI sessions) ----
  mcp.registerTool(
    's2s_vsCommand',
    'Execute any VS Code command in the host window. Pass commandId and optional args array. The command runs in the Agents Window where the S2S extension is loaded.',
    {
      type: 'object',
      properties: {
        commandId: { type: 'string', description: 'VS Code command id (e.g. workbench.action.chat.openNewSessionEditor.copilotcli)' },
        args: { type: 'array', description: 'Positional args to forward to the command', items: {} },
      },
      required: ['commandId'],
    },
    async ({ commandId, args = [] }) => {
      try {
        // Auto-convert {__uri: "scheme:/path"} markers to vscode.Uri instances
        // since URIs can't be JSON-serialized natively.
        const hydrated = args.map(a => {
          if (a && typeof a === 'object' && typeof a.__uri === 'string') {
            return vscode.Uri.parse(a.__uri);
          }
          return a;
        });
        const result = await executeVsCommand({ commandId, args: hydrated }, channel);
        return { ok: true, commandId, result: result === undefined ? null : result };
      } catch (e) {
        return { ok: false, commandId, error: e.message };
      }
    }
  );

  mcp.registerTool(
    's2s_listCommands',
    'List all available VS Code commands, optionally filtered by case-insensitive substring.',
    {
      type: 'object',
      properties: { filter: { type: 'string' } },
    },
    async ({ filter }) => {
      const all = await vscode.commands.getCommands(true);
      const f = (filter || '').toLowerCase();
      const matches = f ? all.filter(c => c.toLowerCase().includes(f)) : all;
      return { count: matches.length, commands: matches };
    }
  );

  mcp.registerTool(
    's2s_info',
    'Info about the host VS Code window.',
    { type: 'object', properties: {} },
    async () => ({
      appName: vscode.env.appName,
      sessionId: vscode.env.sessionId,
      workspaceFolders: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
    })
  );

  mcp.start(MCP_PORT, (m) => channel.appendLine(`[mcp] ${m}`)).catch(e => {
    channel.appendLine(`[mcp] start failed: ${e.message}`);
    vscode.window.showErrorMessage(`S2S MCP server failed on port ${MCP_PORT}: ${e.message}`);
  });
  context.subscriptions.push({ dispose: () => mcp.stop() });

  // Discovery: log all available commands matching a keyword to the output channel.
  context.subscriptions.push(
    vscode.commands.registerCommand('s2s.discoverCommands', async () => {
      const keyword = await vscode.window.showInputBox({
        prompt: 'Filter commands containing (e.g. "session", "chat", "copilot")',
        value: 'session'
      });
      if (!keyword) return;
      const all = await vscode.commands.getCommands(true);
      const matches = all.filter(c => c.toLowerCase().includes(keyword.toLowerCase()));
      channel.appendLine(`\n[discover] commands matching "${keyword}" (${matches.length}):`);
      matches.forEach(c => channel.appendLine(`  ${c}`));
      channel.show(true);
      vscode.window.showInformationMessage(`Found ${matches.length} commands matching "${keyword}" — see S2S output`);
    })
  );
}

function deactivate() { mcp.stop(); }

module.exports = { activate, deactivate };

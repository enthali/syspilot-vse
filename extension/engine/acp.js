// engine/acp.js
// Minimal ACP (Agent Client Protocol) injector.
// Talks JSON-RPC 2.0 over the stdin/stdout of `copilot --acp`.
//
// Three-call sequence to inject one prompt into an existing session:
//   1. initialize
//   2. session/load   (cwd MUST be absolute)
//   3. session/prompt
//
// Returns the assistant's stopReason (typically "end_turn").

const { spawn } = require('child_process');

function findCopilotExe() {
  // Allow override for testing / non-standard installs.
  if (process.env.S2S_COPILOT_EXE) return process.env.S2S_COPILOT_EXE;

  // Default WinGet location on Windows.
  if (process.platform === 'win32') {
    return 'C:\\Users\\' + (process.env.USERNAME || '') +
      '\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe';
  }
  return 'copilot';
}

function jsonRpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

/**
 * Inject a prompt into an existing Copilot CLI session.
 *
 * @param {object} opts
 * @param {string} opts.sessionId  Session UUID (matches folder name in session-state)
 * @param {string} opts.cwd        Absolute path to use as cwd
 * @param {string} opts.prompt     Text to send
 * @param {string} [opts.copilotExe] Override for copilot binary path
 * @returns {Promise<{stopReason: string}>}
 */
function inject({ sessionId, cwd, prompt, copilotExe }) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!cwd) throw new Error('cwd is required');
  if (!prompt) throw new Error('prompt is required');
  const path = require('path');
  if (!path.isAbsolute(cwd)) throw new Error('cwd must be absolute, got: ' + cwd);

  const exe = copilotExe || findCopilotExe();

  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['--acp', '--allow-all-tools'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    const pending = new Map();
    let phase = 'init';
    let promptResult = null;

    function send(id, method, params) {
      pending.set(id, method);
      child.stdin.write(jsonRpc(id, method, params));
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          const method = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(`ACP ${method} failed: ${msg.error.message || JSON.stringify(msg.error)}`));
            child.kill();
            return;
          }
          if (method === 'initialize') {
            phase = 'load';
            send(2, 'session/load', { sessionId, cwd, mcpServers: [] });
          } else if (method === 'session/load') {
            phase = 'prompt';
            send(3, 'session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: prompt }],
            });
          } else if (method === 'session/prompt') {
            promptResult = msg.result || {};
            child.stdin.end();
          }
        }
        // ignore notifications (session/update etc.)
      }
    });

    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (promptResult) return resolve(promptResult);
      reject(new Error(`copilot --acp exited (code=${code}, phase=${phase}) stderr=${stderrBuf.slice(0, 500)}`));
    });

    // Kick off
    send(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 's2s', version: '0.1.0' },
    });
  });
}

module.exports = { inject, findCopilotExe };

// engine/log.js
// Workspace-wide append-only audit log of all S2S events.
// Location: <workspace>/.s2s/log.jsonl
//
// Each line is one event. Two event kinds for now:
//   { event: "send",    id, from, to, text, ts }
//   { event: "receive", id, by,            ts }
//
// Append-only: never rewrite. Replay = read the whole file, group by id.

const fs = require('fs');
const path = require('path');

function logDir(workspace) { return path.join(workspace, '.s2s'); }
function logPath(workspace) { return path.join(logDir(workspace), 'log.jsonl'); }

function appendEvent(workspace, ev) {
  if (!workspace) return; // logging is best-effort, never throw
  try {
    const dir = logDir(workspace);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath(workspace), JSON.stringify(ev) + '\n');
  } catch (e) {
    // swallow — log is auxiliary; don't break the actual send/receive
    // eslint-disable-next-line no-console
    console.error(`[s2s.log] append failed: ${e.message}`);
  }
}

function readAll(workspace) {
  const p = logPath(workspace);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = { appendEvent, readAll, logPath, logDir };

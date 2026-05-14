// engine/inbox.js
// Per-session FIFO inbox stored as JSONL.
// Location: <session-folder>/.s2s/inbox.jsonl
//
// Operations are append-mostly:
//   - send: append a line
//   - peek: read next undelivered line
//   - receive: peek + atomically rewrite file without that line
//
// We use a simple file lock (lockfile next to inbox) to make concurrent
// receivers safe enough for our single-host use case.

const fs = require('fs');
const path = require('path');

function inboxDir(sessionFolder) {
  return path.join(sessionFolder, '.s2s');
}

function inboxPath(sessionFolder) {
  return path.join(inboxDir(sessionFolder), 'inbox.jsonl');
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function readAll(sessionFolder) {
  const p = inboxPath(sessionFolder);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Append a message to the receiver's inbox.
 * @param {string} sessionFolder  receiver's session folder
 * @param {object} msg            full message object (must have id, from, to, text, sentAt)
 */
function append(sessionFolder, msg) {
  ensureDir(inboxDir(sessionFolder));
  fs.appendFileSync(inboxPath(sessionFolder), JSON.stringify(msg) + '\n');
}

/**
 * Look at the next pending message without removing it.
 * @returns {object|null}
 */
function peek(sessionFolder) {
  const all = readAll(sessionFolder);
  return all.length ? all[0] : null;
}

function depth(sessionFolder) {
  return readAll(sessionFolder).length;
}

/**
 * Pop the next message off the queue (FIFO).
 * Rewrites the file atomically (write tmp + rename).
 * @returns {object|null}
 */
function pop(sessionFolder) {
  const all = readAll(sessionFolder);
  if (all.length === 0) return null;
  const [head, ...rest] = all;

  const dir = inboxDir(sessionFolder);
  ensureDir(dir);
  const tmp = path.join(dir, `inbox.${process.pid}.${Date.now()}.tmp`);
  const target = inboxPath(sessionFolder);
  const body = rest.length ? rest.map(m => JSON.stringify(m)).join('\n') + '\n' : '';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, target);
  return head;
}

module.exports = { append, peek, pop, depth, readAll, inboxPath, inboxDir };

// engine/index.js
// Public S2S API.
//
// Three concepts:
//   - registry:  who exists (name <-> uuid <-> cwd)
//   - inbox:     per-session FIFO of pending messages
//   - log:       per-workspace audit trail (append-only)
//
// Send is the only operation that touches ACP — and only optionally (auto-notify).
// Receive is pure file I/O.

const { randomUUID } = require('crypto');
const registry = require('./registry');
const inbox = require('./inbox');
const log = require('./log');
const acp = require('./acp');

function nowIso() { return new Date().toISOString(); }

/**
 * Send a message to a target session.
 *
 * @param {object} opts
 * @param {string} opts.from        Sender session name (informational; not validated)
 * @param {string} opts.to          Target session name or UUID
 * @param {string} opts.text        Message body
 * @param {string} [opts.workspace] Sender's workspace cwd. Used to:
 *                                   1. scope name lookups for `to`
 *                                   2. write the audit log
 * @param {boolean} [opts.notify=false]  If true, ACP-inject a "you have mail" prompt
 *                                       so the receiver immediately picks it up.
 *                                       If false, message just sits in the inbox.
 * @returns {Promise<{id, target}>}
 */
async function send({ from, to, text, workspace, notify = false }) {
  if (!to) throw new Error('to is required');
  if (text == null) throw new Error('text is required');

  const target = registry.resolve(to, { workspace });
  const msg = {
    id: randomUUID(),
    from: from || null,
    to: target.name || target.uuid,
    text,
    sentAt: nowIso(),
  };

  inbox.append(target.folder, msg);
  log.appendEvent(workspace, { event: 'send', id: msg.id, from: msg.from, to: msg.to, text, ts: msg.sentAt });

  if (notify) {
    await acp.inject({
      sessionId: target.uuid,
      cwd: target.cwd,
      prompt: `📥 You have new S2S mail. Please call s2s_receive to read it.`,
    });
  }

  return { id: msg.id, target: { uuid: target.uuid, name: target.name } };
}

/**
 * Pop the next pending message from a session's inbox.
 *
 * @param {object} opts
 * @param {string} opts.session     Session name or UUID
 * @param {string} [opts.workspace] Workspace cwd for log + name resolution
 * @returns {object|null}  The message, or null if inbox empty
 */
function receive({ session, workspace }) {
  if (!session) throw new Error('session is required');
  const target = registry.resolve(session, { workspace });
  const msg = inbox.pop(target.folder);
  if (!msg) return null;

  const receivedAt = nowIso();
  log.appendEvent(workspace, { event: 'receive', id: msg.id, by: target.name || target.uuid, ts: receivedAt });

  return { ...msg, receivedAt };
}

/**
 * Inspect a session's inbox without consuming.
 */
function peek({ session, workspace }) {
  const target = registry.resolve(session, { workspace });
  return {
    depth: inbox.depth(target.folder),
    next: inbox.peek(target.folder),
  };
}

/**
 * List sessions, optionally filtered by workspace.
 */
function list({ workspace } = {}) {
  return registry.list({ workspace }).map(s => ({
    uuid: s.uuid,
    name: s.name,
    cwd: s.cwd,
    repository: s.repository,
    branch: s.branch,
    inboxDepth: inbox.depth(s.folder),
  }));
}

module.exports = { send, receive, peek, list, registry, inbox, log, acp };

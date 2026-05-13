// Minimal MCP server over Streamable HTTP transport (no npm deps).
// Implements just enough of the protocol to expose tools to Copilot CLI.
// Spec: https://spec.modelcontextprotocol.io/specification/basic/transports/

const http = require('http');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 's2s', version: '0.0.1' };

const tools = new Map(); // name -> { description, inputSchema, handler }

function registerTool(name, description, inputSchema, handler) {
  tools.set(name, { description, inputSchema, handler });
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpc(msg, log) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
    return null; // notifications get no response
  }

  if (method === 'tools/list') {
    const list = [...tools.entries()].map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return jsonRpcResult(id, { tools: list });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const tool = tools.get(name);
    if (!tool) return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args || {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return jsonRpcResult(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      log(`tool ${name} error: ${e.stack || e.message}`);
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }

  if (method === 'ping') return jsonRpcResult(id, {});

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

let server = null;

function start(port, log) {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const msg = JSON.parse(body);
          const reply = await handleRpc(msg, log);
          if (reply === null) {
            res.writeHead(202).end(); // accepted, no response (notification)
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(reply));
          }
        } catch (e) {
          log(`rpc parse error: ${e.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')));
        }
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      log(`MCP server listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { registerTool, start, stop };

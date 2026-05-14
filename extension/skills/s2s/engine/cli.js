#!/usr/bin/env node
// engine/cli.js
// Standalone CLI for S2S — works without the VS Code extension.
//
// Usage:
//   node engine/cli.js list [--workspace <path>]
//   node engine/cli.js send --to <name|uuid> --text "<msg>" [--from <name>] [--workspace <path>] [--notify]
//   node engine/cli.js receive --session <name|uuid> [--workspace <path>]
//   node engine/cli.js peek --session <name|uuid> [--workspace <path>]
//
// Output is JSON for easy piping/scripting.

const s2s = require('./index');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(msg) { process.stderr.write('error: ' + msg + '\n'); process.exit(1); }

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  const workspace = args.workspace || process.env.S2S_WORKSPACE || process.cwd();

  try {
    switch (cmd) {
      case 'list':
        out(s2s.list({ workspace: args['all-workspaces'] ? undefined : workspace }));
        return;

      case 'send':
        if (!args.to) fail('--to is required');
        if (args.text === undefined) fail('--text is required');
        out(await s2s.send({
          from: args.from || null,
          to: args.to,
          text: String(args.text),
          workspace,
          notify: !!args.notify,
        }));
        return;

      case 'receive':
        if (!args.session) fail('--session is required');
        out(s2s.receive({ session: args.session, workspace }));
        return;

      case 'peek':
        if (!args.session) fail('--session is required');
        out(s2s.peek({ session: args.session, workspace }));
        return;

      case 'help':
      case undefined:
        process.stdout.write(
          'S2S CLI\n\n' +
          '  list     [--workspace <path>] [--all-workspaces]\n' +
          '  send     --to <name|uuid> --text "<msg>" [--from <name>] [--workspace <path>] [--notify]\n' +
          '  receive  --session <name|uuid> [--workspace <path>]\n' +
          '  peek     --session <name|uuid> [--workspace <path>]\n'
        );
        return;

      default:
        fail(`unknown command: ${cmd}`);
    }
  } catch (e) {
    fail(e.message);
  }
}

main();

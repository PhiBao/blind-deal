import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

const BOT_NAME = process.env.BOT_NAME || 'BlindDeal';

const PROCS: { name: string; proc: ChildProcess | null }[] = [];

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${BOT_NAME}] ${msg}`);
}

function start(name: string, script: string): ChildProcess {
  const fullPath = join(__dirname, script);
  if (!fs.existsSync(fullPath)) {
    log(`ERROR: ${fullPath} not found`);
    process.exit(1);
  }

  log(`Starting ${name}...`);
  const proc = spawn('npx', ['tsx', script], {
    cwd: __dirname,
    stdio: 'pipe',
    detached: false,
  });

  proc.stdout?.on('data', (d) => process.stdout.write(d));
  proc.stderr?.on('data', (d) => process.stderr.write(d));

  proc.on('exit', (code, sig) => {
    const reason = sig ? `signal ${sig}` : `exit ${code}`;
    log(`${name} exited (${reason})`);
    if (sig !== 'SIGINT' && sig !== 'SIGTERM') {
      log(`Restarting ${name} in 5s...`);
      setTimeout(() => {
        PROCS.find(p => p.name === name)!.proc = start(name, script);
      }, 5000);
    }
  });

  proc.on('error', (err) => log(`${name} error: ${err.message}`));

  log(`${name} started (pid ${proc.pid})`);
  return proc;
}

function stop() {
  log('Shutting down...');
  for (const { name, proc } of PROCS) {
    if (proc) {
      log(`Stopping ${name}...`);
      proc.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 3000);
}

const mode = process.argv[2] || 'all';
const mcpPath = 'mcp-server/index.ts';
const tgPath = 'telegram-bot/index.ts';

if (mode === 'all' || mode === 'mcp') {
  PROCS.push({ name: 'MCP Server', proc: start('MCP Server', mcpPath) });
}

if (mode === 'all' || mode === 'telegram') {
  PROCS.push({ name: 'Telegram Bot', proc: start('Telegram Bot', tgPath) });
}

log(`Running in "${mode}" mode (${PROCS.length} service(s))`);

// Handle shutdown signals gracefully
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Keep alive — don't exit
process.stdin.resume();
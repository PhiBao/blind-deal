#!/usr/bin/env tsx
/**
 * BlindDeal — Dev All
 * Spawns all 4 services for local development:
 *   1. Vite frontend dev server (port 3000)
 *   2. Escrow API dev server (port 3002)
 *   3. MCP Server (port 3001)
 *   4. Telegram Bot
 *
 * Usage: npx tsx scripts/dev-all.ts
 *        pnpm dev:all
 *
 * Features:
 *   - Color-coded log prefixes per service
 *   - Auto-restart on crash (with jitter to avoid thundering herd)
 *   - Frees occupied ports before starting
 *   - Graceful Ctrl+C shutdown of all children
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import * as net from 'net';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

dotenv.config({ path: join(ROOT, '.env') });

// ── Config ─────────────────────────────────────────────────────────────

interface ServiceDef {
  name: string;
  color: string;
  port?: number;          // if set, free this port before starting
  cmd: string;
  args: string[];
  cwd: string;
  delay: number;          // ms to wait before starting (staggered launch)
}

const COLORS: Record<string, string> = {
  frontend: '\x1b[36m',
  api:      '\x1b[33m',
  mcp:      '\x1b[35m',
  telegram: '\x1b[32m',
  'dev-all': '\x1b[1;37m',
};
const RESET = '\x1b[0m';

const FRONTEND_DIR = join(ROOT, 'frontend');

const SERVICES: ServiceDef[] = [
  { name: 'frontend', color: COLORS.frontend, port: 3000, cmd: 'npx', args: ['vite', '--force', '--host'], cwd: FRONTEND_DIR, delay: 0 },
  { name: 'api',      color: COLORS.api,      port: 3002, cmd: 'npx', args: ['tsx', 'dev-api.mjs'],      cwd: FRONTEND_DIR, delay: 2000 },
  { name: 'mcp',      color: COLORS.mcp,      port: 3001, cmd: 'npx', args: ['tsx', 'mcp-server/index.ts'], cwd: ROOT,        delay: 3000 },
];

if (process.env.TELEGRAM_BOT_TOKEN) {
  SERVICES.push({ name: 'telegram', color: COLORS.telegram, cmd: 'npx', args: ['tsx', 'telegram-bot/index.ts'], cwd: ROOT, delay: 4000 });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function prefix(name: string) {
  const c = COLORS[name] || '\x1b[90m';
  return `${c}[${name.padEnd(10)}]${RESET}`;
}

function log(name: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${prefix('dev-all')} ${prefix(name).trim()} ${ts} ${msg}`);
}

/** Check if a TCP port is free. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '0.0.0.0');
  });
}

/** Kill the entire previous dev-all process tree (not just children). */
function killAllBlindDealProcs(): void {
  try {
    // Find the OTHER dev-all.sh process (not ourselves)
    const ppid = process.pid;
    const others = execSync(
      `ps aux | grep "scripts/dev-all.ts" | grep -v grep | awk '{print $2}' | grep -v "^${ppid}$"`,
      { encoding: 'utf-8' }
    ).toString().trim().split('\n').filter(Boolean);
    for (const pid of others) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore' }); } catch {}
    }
  } catch {}
  // Also try to free any residual processes by port
  for (const port of [3000, 3001, 3002]) {
    try { execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' }); } catch {}
  }
}

/** Free a port by killing whatever process is holding it + waiting for release. */
async function freePort(port: number): Promise<void> {
  // Kill all processes on this port (SIGTERM first, then SIGKILL)
  try {
    execSync(`lsof -ti:${port} | xargs -r kill 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
  // Wait up to 5s for the port to become free
  for (let i = 0; i < 15; i++) {
    if (await isPortFree(port)) return;
    await new Promise((r) => setTimeout(r, 350));
  }
  log('dev-all', `WARNING: Could not free port ${port} — services may fail to bind`);
}

// ── Process Management ──────────────────────────────────────────────────

interface ProcEntry { def: ServiceDef; proc: ChildProcess | null }
const entries: ProcEntry[] = [];
let exiting = false;

function startService(def: ServiceDef): ChildProcess {
  const { name, cmd, args, cwd, color } = def;
  log(name, `Starting: ${cmd} ${args.join(' ')}`);
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const tag = `${color}${prefix(name)}${RESET}`;

  proc.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(`${tag} ${line}`);
    }
  });
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.error(`${tag} ${line}`);
    }
  });

  proc.on('exit', (code, sig) => {
    if (exiting) return;
    const reason = sig ? `signal ${sig}` : `exit ${code}`;
    log(name, `Exited (${reason}) — restarting in 3s`);
    const entry = entries.find((e) => e.def.name === name);
    // Add jitter (0-2s) so all services don't restart simultaneously
    const jitter = Math.floor(Math.random() * 2000);
    setTimeout(async () => {
      if (def.port) await freePort(def.port);
      if (entry) entry.proc = startService(def);
    }, 3000 + jitter);
  });

  proc.on('error', (err) => log(name, `Error: ${err.message}`));
  return proc;
}

// ── Launch ──────────────────────────────────────────────────────────────

async function main() {
  // Kill ALL leftover blinddeal processes first (handles Telegram 409, stale Vite, etc.)
  log('dev-all', 'Cleaning up any leftover blinddeal processes...');
  killAllBlindDealProcs();
  await new Promise((r) => setTimeout(r, 1500));

  // Then free all ports
  const ports = SERVICES.filter((s) => s.port).map((s) => s.port!);
  log('dev-all', `Checking ports: ${ports.join(', ')}...`);
  await Promise.all(ports.map(freePort));

  // Staggered launch
  for (const def of SERVICES) {
    setTimeout(async () => {
      if (def.port) await freePort(def.port);
      const proc = startService(def);
      entries.push({ def, proc });
    }, def.delay);
  }

  log('dev-all', 'All services starting — press Ctrl+C to stop all');
  console.log(`\n  ${prefix('frontend')} http://localhost:3000`);
  console.log(`  ${prefix('api')}      http://localhost:3002`);
  console.log(`  ${prefix('mcp')}      http://localhost:3001/health`);
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log(`  ${prefix('telegram')}  Bot running`);
  }
  console.log();
}

// ── Shutdown ────────────────────────────────────────────────────────────

function shutdown() {
  if (exiting) return;
  exiting = true;
  log('dev-all', 'Shutting down all services...');
  for (const { def, proc } of entries) {
    if (proc && proc.exitCode === null) {
      log(def.name, 'Stopping...');
      proc.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.resume();

main().catch((err) => {
  console.error('dev-all fatal:', err);
  process.exit(1);
});

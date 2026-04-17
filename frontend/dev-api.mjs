/**
 * Standalone dev API server for local testing.
 * Mirrors the Vercel API routes in api/escrow/*.ts using @reineira-os/sdk.
 * Run: node dev-api.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env.local
const envPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}

// Also load root .env as fallback
const rootEnvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}

/** Parse JSON body from request */
function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

/** Send JSON response */
function jsonRes(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/** Lazily cached SDK instance */
let sdkInstance = null;
const { ReineiraSDK } = require('@reineira-os/sdk');

async function getSDK() {
  if (sdkInstance) return sdkInstance;
  const sdk = ReineiraSDK.create({
    network: 'testnet',
    privateKey: process.env.PRIVATE_KEY,
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  });
  await sdk.initialize();
  sdkInstance = sdk;
  return sdk;
}

/** POST /api/escrow/create */
async function handleCreate(body) {
  const { amount, owner, resolver, resolverData } = body;
  if (amount == null || !owner) {
    return { status: 400, data: { error: 'Missing required fields: amount, owner' } };
  }

  const sdk = await getSDK();
  const builder = sdk.escrow.build()
    .amount(sdk.usdc(Number(amount)))
    .owner(owner);

  if (resolver) {
    builder.condition(resolver, resolverData || '0x');
  }

  const escrow = await builder.create();
  return {
    status: 200,
    data: {
      escrow_id: escrow.id.toString(),
      tx_hash: escrow.createTx.hash,
      block_number: escrow.createTx.blockNumber,
    },
  };
}

/** POST /api/escrow/fund */
async function handleFund(body) {
  const { escrowId, amount } = body;
  if (escrowId == null || amount == null) {
    return { status: 400, data: { error: 'Missing required fields: escrowId, amount' } };
  }

  const sdk = await getSDK();
  const escrow = sdk.escrow.get(BigInt(escrowId));

  const approved = await escrow.isApproved();
  if (!approved) {
    await escrow.approve();
  }

  const result = await escrow.fund(sdk.usdc(Number(amount)));
  return {
    status: 200,
    data: {
      tx_hash: result.tx.hash,
      block_number: result.tx.blockNumber,
    },
  };
}

const ROUTES = {
  '/api/escrow/create': handleCreate,
  '/api/escrow/fund': handleFund,
};

const PORT = 3002;

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return jsonRes(res, 200, {});
  }

  const url = req.url?.split('?')[0];
  const handler = ROUTES[url];

  if (!handler) {
    return jsonRes(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'POST') {
    return jsonRes(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = await parseBody(req);
    console.log(`→ ${url}`, JSON.stringify(body));
    const { status, data } = await handler(body);
    console.log(`← ${status}`, JSON.stringify(data));
    jsonRes(res, status, data);
  } catch (err) {
    console.error(`API error (${url}):`, err);
    jsonRes(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`API dev server running on http://localhost:${PORT}`);
  console.log(`Routes: ${Object.keys(ROUTES).join(', ')}`);
});

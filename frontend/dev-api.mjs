/**
 * Dev API server for local testing — escrow create, fund & redeem.
 * Uses @reineira-os/sdk@0.3.1 (→ @cofhe/sdk@0.5.2) for FHE encryption.
 * Fund/redeem use viem directly to avoid ethers.js overloaded function encoding bug.
 * Run: node dev-api.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPublicClient, createWalletClient, http as viemHttp, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env.local then root .env as fallback
for (const p of [path.resolve(__dirname, '.env.local'), path.resolve(__dirname, '..', '.env')]) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  }
}

function parseBody(req) {
  return new Promise((r) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{r(JSON.parse(d))}catch{r({})} }); });
}
function jsonRes(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  res.end(JSON.stringify(data));
}

// ── Chain & Clients ────────────────────────────────────────────────
const arbSepolia = defineChain({
  id: 421614,
  name: 'Arbitrum Sepolia',
  network: 'arb-sepolia',
  rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'] } },
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
});

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const account = privateKeyToAccount(PRIVATE_KEY);
const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const transport = viemHttp(rpcUrl);

const publicClient = createPublicClient({ chain: arbSepolia, transport });
const walletClient = createWalletClient({ account, chain: arbSepolia, transport });

// Reineira SDK v0.3.1 addresses
const ESCROW_ADDRESS = '0xbe1eEB78504B71beEE1b33D3E3D367A2F9a549A6';
const CONF_USDC_ADDRESS = '0x42E47f9bA89712C317f60A72C81A610A2b68c48a';

// Explicit ABI — avoids ethers.js overloaded function ambiguity
const ESCROW_ABI = parseAbi([
  'function fund(uint256 escrowId, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedPayment)',
  'function fundFrom(uint256 escrowId, uint256 amount)',
  'function redeem(uint256 escrowId)',
  'function exists(uint256 escrowId) view returns (bool)',
  'function getOwner(uint256 escrowId) view returns (address)',
  'function getAmount(uint256 escrowId) view returns (uint256)',
  'function getPaidAmount(uint256 escrowId) view returns (uint256)',
  'function paymentToken() view returns (address)',
  'function getConditionResolver(uint256 escrowId) view returns (address)',
  'event EscrowCreated(uint256 indexed escrowId)',
  'event EscrowFunded(uint256 indexed escrowId, address indexed payer)',
  'event EscrowRedeemed(uint256 indexed escrowId)',
]);

const CONF_USDC_ABI = parseAbi([
  'function setOperator(address operator, uint48 until)',
  'function isOperator(address holder, address spender) view returns (bool)',
  'function confidentialTransfer(address to, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) inValue) returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

// ── Reineira SDK (for create + FHE encryption) ────────────────────
const { ReineiraSDK } = require('@reineira-os/sdk');
let sdkInstance = null;

async function getSDK() {
  if (sdkInstance) return sdkInstance;
  const sdk = ReineiraSDK.create({ network: 'testnet', privateKey: PRIVATE_KEY, rpcUrl });
  await sdk.initialize();
  sdkInstance = sdk;
  return sdk;
}

// ── Handlers ──────────────────────────────────────────────────────

async function handleCreate(body) {
  const { amount, owner, resolver, resolverData } = body;
  if (amount == null || !owner) return { status: 400, data: { error: 'Missing amount, owner' } };

  const sdk = await getSDK();

  // Encrypt owner and amount with CoFHE SDK
  const encOwner = await sdk.fhe.encryptAddress(owner);
  const encAmount = await sdk.fhe.encryptUint64(sdk.usdc(Number(amount)));

  // Use viem for contract call (ethers.js can't handle overloaded proxy functions)
  const h = (e) => e.signature?.startsWith('0x') ? e.signature : `0x${e.signature}`;
  const txHash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: parseAbi(['function create((uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedOwner, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount, address resolver, bytes resolverData) returns (uint256 escrowId)']),
    functionName: 'create',
    args: [
      { ctHash: encOwner.ctHash, securityZone: encOwner.securityZone, utype: encOwner.utype, signature: h(encOwner) },
      { ctHash: encAmount.ctHash, securityZone: encAmount.securityZone, utype: encAmount.utype, signature: h(encAmount) },
      resolver || '0x0000000000000000000000000000000000000000',
      resolverData || '0x',
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Extract escrow ID from event
  let escrowId = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase() && log.topics.length > 1 && log.topics[1]) {
      try { escrowId = BigInt(log.topics[1]); } catch {}
      break;
    }
  }

  return { status: 200, data: { escrow_id: escrowId?.toString(), tx_hash: txHash, block_number: receipt.blockNumber.toString() } };
}

async function handleFund(body) {
  const { escrowId, amount } = body;
  if (escrowId == null || amount == null) return { status: 400, data: { error: 'Missing escrowId, amount' } };

  // Step 1: Approve escrow as ConfUSDC operator (if needed)
  const isApproved = await publicClient.readContract({
    address: CONF_USDC_ADDRESS, abi: CONF_USDC_ABI, functionName: 'isOperator',
    args: [account.address, ESCROW_ADDRESS],
  });
  if (!isApproved) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);
    const approveHash = await walletClient.writeContract({
      address: CONF_USDC_ADDRESS, abi: CONF_USDC_ABI, functionName: 'setOperator',
      args: [ESCROW_ADDRESS, expiry],
    });
    console.log('[Fund] ConfUSDC approve tx:', approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('[Fund] ConfUSDC approved');
  }

  // Step 2: Encrypt the amount using CoFHE SDK via Reineira
  const sdk = await getSDK();
  const encryptedPayment = await sdk.fhe.encryptUint64(sdk.usdc(Number(amount)));
  const h = (e) => e.signature?.startsWith('0x') ? e.signature : `0x${e.signature}`;
  console.log('[Fund] Encrypted payment ctHash:', encryptedPayment.ctHash.toString().slice(0, 20) + '...');

  // Step 3: Call fund() with viem (explicit ABI avoids overloaded function issue)
  const fundHash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'fund',
    args: [BigInt(escrowId), {
      ctHash: encryptedPayment.ctHash,
      securityZone: encryptedPayment.securityZone,
      utype: encryptedPayment.utype,
      signature: h(encryptedPayment),
    }],
  });
  console.log('[Fund] Fund tx:', fundHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
  if (receipt.status === 'success') {
    return { status: 200, data: { tx_hash: fundHash, block_number: receipt.blockNumber.toString() } };
  }
  return { status: 500, data: { error: 'Fund transaction reverted on-chain' } };
}

async function handleRedeem(body) {
  const { escrowId } = body;
  if (escrowId == null) return { status: 400, data: { error: 'Missing escrowId' } };

  const redeemHash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'redeem',
    args: [BigInt(escrowId)],
  });
  console.log('[Redeem] Tx:', redeemHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
  if (receipt.status === 'success') {
    return { status: 200, data: { tx_hash: redeemHash, block_number: receipt.blockNumber.toString() } };
  }
  return { status: 500, data: { error: 'Redeem transaction reverted on-chain' } };
}

const ROUTES = { '/api/escrow/create': handleCreate, '/api/escrow/fund': handleFund, '/api/escrow/redeem': handleRedeem };
const PORT = 3002;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return jsonRes(res, 200, {});
  const url = req.url?.split('?')[0];
  const handler = ROUTES[url];
  if (!handler) return jsonRes(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return jsonRes(res, 405, { error: 'Method not allowed' });
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
  console.log(`Account: ${account.address}`);
});

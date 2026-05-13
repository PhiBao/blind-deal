import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const arbSepolia = defineChain({
  id: 421614, name: 'Arbitrum Sepolia', network: 'arb-sepolia',
  rpcUrls: { default: { http: [process.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'] } },
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
});

const ESCROW_ADDRESS = '0xbe1eEB78504B71beEE1b33D3E3D367A2F9a549A6';

const ESCROW_ABI = parseAbi([
  'function create((uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedOwner, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedAmount, address resolver, bytes resolverData) returns (uint256 escrowId)',
  'event EscrowCreated(uint256 indexed escrowId)',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount, owner, resolver, resolverData } = req.body ?? {};
  if (amount == null || !owner) {
    return res.status(400).json({ error: 'Missing required fields: amount, owner' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'Server PRIVATE_KEY not configured' });

  try {
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    const rpcUrl = process.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: arbSepolia, transport });
    const walletClient = createWalletClient({ account, chain: arbSepolia, transport });

    // Encrypt with Reineira SDK
    const { ReineiraSDK } = require('@reineira-os/sdk');
    const sdk = ReineiraSDK.create({ network: 'testnet', privateKey: PRIVATE_KEY, rpcUrl });
    await sdk.initialize();

    const encOwner = await sdk.fhe.encryptAddress(owner);
    const encAmount = await sdk.fhe.encryptUint64(sdk.usdc(Number(amount)));
    const h = (e: any) => e.signature?.startsWith('0x') ? e.signature : `0x${e.signature}`;

    // Use viem for contract call
    const txHash = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'create',
      args: [
        { ctHash: encOwner.ctHash, securityZone: encOwner.securityZone, utype: encOwner.utype, signature: h(encOwner) },
        { ctHash: encAmount.ctHash, securityZone: encAmount.securityZone, utype: encAmount.utype, signature: h(encAmount) },
        (resolver || '0x0000000000000000000000000000000000000000') as `0x${string}`,
        (resolverData || '0x') as `0x${string}`,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let escrowId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase() && log.topics.length > 1 && log.topics[1]) {
        try { escrowId = BigInt(log.topics[1]); } catch {}
        break;
      }
    }

    return res.status(200).json({
      escrow_id: escrowId?.toString(),
      tx_hash: txHash,
      block_number: receipt.blockNumber.toString(),
    });
  } catch (err) {
    console.error('Escrow creation failed:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create escrow' });
  }
}

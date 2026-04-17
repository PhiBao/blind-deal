import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { escrowId, amount } = req.body ?? {};
  if (escrowId == null || amount == null) {
    return res.status(400).json({ error: 'Missing required fields: escrowId, amount' });
  }

  try {
    const { ReineiraSDK } = require('@reineira-os/sdk');

    const sdk = ReineiraSDK.create({
      network: 'testnet' as const,
      privateKey: process.env.PRIVATE_KEY!,
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    });

    await sdk.initialize();

    const escrow = sdk.escrow.get(BigInt(escrowId));

    // Auto-approve if needed
    const approved = await escrow.isApproved();
    if (!approved) {
      await escrow.approve();
    }

    const result = await escrow.fund(sdk.usdc(Number(amount)));

    return res.status(200).json({
      tx_hash: result.tx.hash,
      block_number: result.tx.blockNumber,
    });
  } catch (err) {
    console.error('Escrow funding failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fund escrow',
    });
  }
}

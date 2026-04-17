import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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

  try {
    const { ReineiraSDK } = require('@reineira-os/sdk');

    const sdk = ReineiraSDK.create({
      network: 'testnet' as const,
      privateKey: process.env.PRIVATE_KEY!,
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    });

    await sdk.initialize();

    const builder = sdk.escrow.build()
      .amount(sdk.usdc(Number(amount)))
      .owner(owner);

    if (resolver) {
      builder.condition(resolver, resolverData || '0x');
    }

    const escrow = await builder.create();

    return res.status(200).json({
      escrow_id: escrow.id.toString(),
      tx_hash: escrow.createTx.hash,
      block_number: escrow.createTx.blockNumber,
    });
  } catch (err) {
    console.error('Escrow creation failed:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create escrow',
    });
  }
}

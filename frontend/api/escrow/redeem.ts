import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arbSepolia = defineChain({
  id: 421614, name: 'Arbitrum Sepolia', network: 'arb-sepolia',
  rpcUrls: { default: { http: [process.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'] } },
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
});

const ESCROW_ADDRESS = '0xbe1eEB78504B71beEE1b33D3E3D367A2F9a549A6';

const ESCROW_ABI = parseAbi([
  'function redeem(uint256 escrowId)',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { escrowId } = req.body ?? {};
  if (escrowId == null) return res.status(400).json({ error: 'Missing escrowId' });

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'Server PRIVATE_KEY not configured' });

  try {
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    const rpcUrl = process.env.VITE_ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: arbSepolia, transport });
    const walletClient = createWalletClient({ account, chain: arbSepolia, transport });

    const redeemHash = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'redeem',
      args: [BigInt(escrowId)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
    if (receipt.status === 'success') {
      return res.status(200).json({ tx_hash: redeemHash, block_number: receipt.blockNumber.toString() });
    }
    return res.status(500).json({ error: 'Redeem transaction reverted on-chain' });
  } catch (err) {
    console.error('Escrow redeem failed:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to redeem escrow' });
  }
}

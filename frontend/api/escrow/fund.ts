import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const arbSepolia = defineChain({
  id: 421614, name: 'Arbitrum Sepolia', network: 'arb-sepolia',
  rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'] } },
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
});

const ESCROW_ADDRESS = '0xbe1eEB78504B71beEE1b33D3E3D367A2F9a549A6';
const CONF_USDC_ADDRESS = '0x42E47f9bA89712C317f60A72C81A610A2b68c48a';

const ESCROW_ABI = parseAbi([
  'function fund(uint256 escrowId, (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encryptedPayment)',
]);
const CONF_USDC_ABI = parseAbi([
  'function setOperator(address operator, uint48 until)',
  'function isOperator(address holder, address spender) view returns (bool)',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { escrowId, amount } = req.body ?? {};
  if (escrowId == null || amount == null) {
    return res.status(400).json({ error: 'Missing escrowId, amount' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'Server PRIVATE_KEY not configured' });

  try {
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: arbSepolia, transport });
    const walletClient = createWalletClient({ account, chain: arbSepolia, transport });

    // Approve ConfUSDC if needed
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
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // Encrypt amount with Reineira SDK
    const { ReineiraSDK } = require('@reineira-os/sdk');
    const sdk = ReineiraSDK.create({ network: 'testnet', privateKey: PRIVATE_KEY, rpcUrl });
    await sdk.initialize();
    const encryptedPayment = await sdk.fhe.encryptUint64(sdk.usdc(Number(amount)));
    const h = (e: any) => e.signature?.startsWith('0x') ? e.signature : `0x${e.signature}`;

    // Fund with viem
    const fundHash = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'fund',
      args: [BigInt(escrowId), {
        ctHash: encryptedPayment.ctHash,
        securityZone: encryptedPayment.securityZone,
        utype: encryptedPayment.utype,
        signature: h(encryptedPayment) as `0x${string}`,
      }],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
    if (receipt.status === 'success') {
      return res.status(200).json({ tx_hash: fundHash, block_number: receipt.blockNumber.toString() });
    }
    return res.status(500).json({ error: 'Fund transaction reverted on-chain' });
  } catch (err) {
    console.error('Escrow funding failed:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fund escrow' });
  }
}

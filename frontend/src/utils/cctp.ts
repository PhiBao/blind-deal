// Circle CCTP v2 cross-chain USDC bridge
// Ethereum Sepolia -> Arbitrum Sepolia

import { parseAbi, createPublicClient, createWalletClient, http, type WalletClient, type PublicClient, type Chain, type Transport, type Account } from 'viem';
import { sepolia, arbitrumSepolia } from 'viem/chains';

// ── Contract addresses ──────────────────────────────────────────────

const TOKEN_MESSENGER_ETHEREUM_SEPOLIA = '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5' as const;
const MESSAGE_TRANSMITTER_ARBITRUM_SEPOLIA = '0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872' as const;
const USDC_ETHEREUM_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const MESSAGE_TRANSMITTER_ETHEREUM_SEPOLIA = '0x7865fAfC2db2093669d92c0F33AeEF291086BABD' as const;

// ── ABIs ────────────────────────────────────────────────────────────

const TokenMessengerABI = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)',
  'event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)',
] as const);

const MessageTransmitterABI = parseAbi([
  'function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success)',
  'function hashMessage(bytes calldata message) external pure returns (bytes32)',
  'event MessageSent(bytes message)',
] as const);

const ERC20ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
] as const);

// ── Domain IDs ──────────────────────────────────────────────────────

const DOMAIN_ARBITRUM_SEPOLIA = 3;

// ── Types ───────────────────────────────────────────────────────────

export interface CCTPProgress {
  step: 'approve' | 'burn' | 'attest' | 'mint' | 'done' | 'error';
  message?: string;
  nonce?: bigint;
  txHash?: string;
}

export type CCTPCallback = (progress: CCTPProgress) => void;

// ── Helpers ─────────────────────────────────────────────────────────

function addressToBytes32(addr: string): `0x${string}` {
  return `0x${addr.replace('0x', '').padStart(64, '0')}` as `0x${string}`;
}

async function fetchAttestation(messageHash: string): Promise<string | null> {
  const url = `https://iris-api-sandbox.circle.com/attestations/${messageHash}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'complete') {
      return data.attestation as string;
    }
    return null;
  } catch {
    return null;
  }
}

async function pollAttestation(messageHash: string, timeoutMs = 300000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const attestation = await fetchAttestation(messageHash);
    if (attestation) return attestation;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Attestation timeout — CCTP message not attested');
}

// ── Main bridge function ────────────────────────────────────────────

/**
 * Bridge USDC from Ethereum Sepolia to Arbitrum Sepolia via CCTP v2.
 *
 * @param amount   Amount in USDC base units (6 decimals)
 * @param recipient Address to receive minted USDC on Arbitrum Sepolia
 * @param ethWalletClient Wallet client on Ethereum Sepolia
 * @param arbPublicClient Public client on Arbitrum Sepolia
 * @param onProgress Progress callback
 */
export async function bridgeUSDCViaCCTP({
  amount,
  recipient,
  ethWalletClient,
  arbPublicClient,
  onProgress,
}: {
  amount: bigint;
  recipient: `0x${string}`;
  ethWalletClient: WalletClient<Transport, Chain, Account>;
  arbPublicClient: PublicClient;
  onProgress?: CCTPCallback;
}) {
  const account = ethWalletClient.account;
  if (!account) throw new Error('Wallet client must have an account');

  const senderAddress = account.address;

  const ethPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  // 1. Approve TokenMessenger to spend USDC
  onProgress?.({ step: 'approve', message: 'Approving USDC burn on Ethereum Sepolia...' });

  const allowance = await ethPublicClient.readContract({
    address: USDC_ETHEREUM_SEPOLIA,
    abi: ERC20ABI,
    functionName: 'allowance',
    args: [account.address, TOKEN_MESSENGER_ETHEREUM_SEPOLIA],
  });

  if (allowance < amount) {
    const approveHash = await ethWalletClient.writeContract({
      account: senderAddress,
      address: USDC_ETHEREUM_SEPOLIA,
      abi: ERC20ABI,
      functionName: 'approve',
      args: [TOKEN_MESSENGER_ETHEREUM_SEPOLIA, amount],
    });
    await ethPublicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // 2. Deposit for burn
  onProgress?.({ step: 'burn', message: 'Burning USDC on Ethereum Sepolia...' });

  const burnHash = await ethWalletClient.writeContract({
    account: senderAddress,
    address: TOKEN_MESSENGER_ETHEREUM_SEPOLIA,
    abi: TokenMessengerABI,
    functionName: 'depositForBurn',
    args: [
      amount,
      DOMAIN_ARBITRUM_SEPOLIA,
      addressToBytes32(recipient),
      USDC_ETHEREUM_SEPOLIA,
    ],
  });

  const burnReceipt = await ethPublicClient.waitForTransactionReceipt({ hash: burnHash });
  onProgress?.({ step: 'burn', message: 'Burn confirmed. Waiting for attestation...', txHash: burnHash });

  // 3. Parse nonce from event logs
  const depositLog = burnReceipt.logs.find(
    (log: { address: string; topics: string[] }) =>
      log.address.toLowerCase() === TOKEN_MESSENGER_ETHEREUM_SEPOLIA.toLowerCase() &&
      log.topics[0] === '0x2fa9ca794907468b0a4044117cb75230918368a771bd55739e3d6d0c20da0067'
  );

  if (!depositLog) {
    throw new Error('DepositForBurn event not found in transaction receipt');
  }

  const nonce = BigInt(depositLog.topics[1]!);
  onProgress?.({ step: 'attest', message: `Polling Circle attestation (nonce: ${nonce})...`, nonce });

  // Wait a bit for Circle to process
  await new Promise((r) => setTimeout(r, 15000));

  // Parse MessageSent event from MessageTransmitter on Ethereum Sepolia
  const messageSentLogs = await ethPublicClient.getContractEvents({
    address: MESSAGE_TRANSMITTER_ETHEREUM_SEPOLIA,
    abi: parseAbi(['event MessageSent(bytes message)']),
    fromBlock: burnReceipt.blockNumber,
    toBlock: burnReceipt.blockNumber,
  });

  const messageLog = messageSentLogs.find((log) => log.blockNumber === burnReceipt.blockNumber);
  if (!messageLog) {
    throw new Error('MessageSent event not found');
  }

  const messageBytes = (messageLog.args as { message: `0x${string}` }).message;
  const msgHash = await ethPublicClient.readContract({
    address: MESSAGE_TRANSMITTER_ETHEREUM_SEPOLIA,
    abi: parseAbi(['function hashMessage(bytes calldata message) external pure returns (bytes32)']),
    functionName: 'hashMessage',
    args: [messageBytes],
  });

  onProgress?.({ step: 'attest', message: `Waiting for Circle attestation (hash: ${msgHash.slice(0, 16)}...)...` });

  const attestation = await pollAttestation(msgHash);
  onProgress?.({ step: 'mint', message: 'Attestation received. Minting on Arbitrum Sepolia...' });

  return {
    messageBytes,
    attestation,
    nonce,
  };
}

/**
 * Final step: receive (mint) USDC on Arbitrum Sepolia.
 * Call this after the user has switched to Arbitrum Sepolia.
 */
export async function receiveCCTPMessageOnArbitrum({
  messageBytes,
  attestation,
  arbWalletClient,
}: {
  messageBytes: `0x${string}`;
  attestation: string;
  arbWalletClient: WalletClient<Transport, Chain, Account>;
}) {
  const arbPublicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(),
  });

  const hash = await arbWalletClient.writeContract({
    account: arbWalletClient.account.address,
    address: MESSAGE_TRANSMITTER_ARBITRUM_SEPOLIA,
    abi: MessageTransmitterABI,
    functionName: 'receiveMessage',
    args: [messageBytes, attestation as `0x${string}`],
  });
  return arbPublicClient.waitForTransactionReceipt({ hash });
}

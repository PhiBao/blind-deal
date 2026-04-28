import { useChainId } from 'wagmi';

// v2 contract addresses (Expired state, createdAt, max deadline, gas-optimized ACL)
const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  421614: '0xCd587f1d57c24cff0D83c1A5f686D2d364114c55', // Arbitrum Sepolia (v2)
  11155111: '0xBe1F302cbfAbc88494e93E0ca28C44f614cc9EC6', // Ethereum Sepolia (v2)
};

const RESOLVER_ADDRESSES: Record<number, `0x${string}`> = {
  421614: '0x0413900b49F140aE7d9F4e2040A8Ec923582A475', // Arbitrum Sepolia (v2)
  11155111: '0x194365D8081185e09960cdC2B599101Af8f95502', // Ethereum Sepolia (v2)
};

// Fallback for when no wallet is connected (e.g. read-only views)
export const BLIND_DEAL_ADDRESS_FALLBACK = CONTRACT_ADDRESSES[421614];

export function useBlindDealAddress(): `0x${string}` {
  const chainId = useChainId();
  return CONTRACT_ADDRESSES[chainId] ?? BLIND_DEAL_ADDRESS_FALLBACK;
}

export function useResolverAddress(): `0x${string}` | undefined {
  const chainId = useChainId();
  return RESOLVER_ADDRESSES[chainId];
}

export const RESOLVER_ABI = [
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'dealId', type: 'uint256' }],
    name: 'linkEscrow', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'isConditionMet', outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'registered', outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    name: 'escrowToDeal', outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view', type: 'function',
  },
] as const;

export const BLIND_DEAL_ABI = [
  // Errors
  { inputs: [], name: 'AlreadySubmitted', type: 'error' },
  { inputs: [], name: 'DealExpired', type: 'error' },
  { inputs: [], name: 'DealNotExpired', type: 'error' },
  { inputs: [], name: 'DealNotOpen', type: 'error' },
  { inputs: [], name: 'DealNotResolved', type: 'error' },
  { inputs: [], name: 'InvalidDeadline', type: 'error' },
  { inputs: [], name: 'NotBuyer', type: 'error' },
  { inputs: [], name: 'NotParticipant', type: 'error' },
  { inputs: [], name: 'NotSeller', type: 'error' },
  { inputs: [], name: 'SelfDeal', type: 'error' },
  { inputs: [], name: 'ZeroAddress', type: 'error' },

  // Events
  {
    anonymous: false, type: 'event', name: 'DealCreated',
    inputs: [
      { indexed: true, name: 'dealId', type: 'uint256' },
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: true, name: 'seller', type: 'address' },
      { indexed: false, name: 'description', type: 'string' },
    ],
  },
  {
    anonymous: false, type: 'event', name: 'PriceSubmitted',
    inputs: [
      { indexed: true, name: 'dealId', type: 'uint256' },
      { indexed: true, name: 'party', type: 'address' },
    ],
  },
  {
    anonymous: false, type: 'event', name: 'DealResolving',
    inputs: [{ indexed: true, name: 'dealId', type: 'uint256' }],
  },
  {
    anonymous: false, type: 'event', name: 'DealResolved',
    inputs: [
      { indexed: true, name: 'dealId', type: 'uint256' },
      { indexed: false, name: 'state', type: 'uint8' },
    ],
  },
  {
    anonymous: false, type: 'event', name: 'DealCancelled',
    inputs: [
      { indexed: true, name: 'dealId', type: 'uint256' },
      { indexed: true, name: 'cancelledBy', type: 'address' },
    ],
  },
  {
    anonymous: false, type: 'event', name: 'DealExpired',
    inputs: [
      { indexed: true, name: 'dealId', type: 'uint256' },
      { indexed: false, name: 'deadline', type: 'uint256' },
    ],
  },

  // Read functions
  {
    inputs: [], name: 'dealCount', outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealState',
    outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealParties',
    outputs: [{ name: 'buyer', type: 'address' }, { name: 'seller', type: 'address' }],
    stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealDescription',
    outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'isDealSubmitted',
    outputs: [{ name: 'buyerDone', type: 'bool' }, { name: 'sellerDone', type: 'bool' }],
    stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealPrice',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getMatchResult',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealDeadline',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'getDealCreatedAt',
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }], name: 'getUserDeals',
    outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }], name: 'isDecryptionReady',
    outputs: [{ name: 'ready', type: 'bool' }, { name: 'matched', type: 'bool' }],
    stateMutability: 'view', type: 'function',
  },

  // Write functions
  {
    inputs: [
      { name: '_seller', type: 'address' },
      { name: '_description', type: 'string' },
      { name: '_duration', type: 'uint256' },
    ],
    name: 'createDeal', outputs: [{ name: 'dealId', type: 'uint256' }],
    stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { name: 'dealId', type: 'uint256' },
      {
        name: 'encryptedMax', type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    name: 'submitBuyerPrice', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { name: 'dealId', type: 'uint256' },
      {
        name: 'encryptedMin', type: 'tuple',
        components: [
          { name: 'ctHash', type: 'uint256' },
          { name: 'securityZone', type: 'uint8' },
          { name: 'utype', type: 'uint8' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    name: 'submitSellerPrice', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }],
    name: 'finalizeDeal', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { name: 'dealId', type: 'uint256' },
      { name: 'matched', type: 'bool' },
    ],
    name: 'clientFinalizeDeal', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }],
    name: 'cancelDeal', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'dealId', type: 'uint256' }],
    name: 'expireDeal', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
] as const;

export enum DealState {
  Open = 0,
  Matched = 1,
  NoMatch = 2,
  Cancelled = 3,
  Expired = 4,
}

export const DEAL_STATE_LABELS: Record<DealState, string> = {
  [DealState.Open]: 'Open',
  [DealState.Matched]: 'Matched',
  [DealState.NoMatch]: 'No Match',
  [DealState.Cancelled]: 'Cancelled',
  [DealState.Expired]: 'Expired',
};

export const DEAL_STATE_COLORS: Record<DealState, string> = {
  [DealState.Open]: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
  [DealState.Matched]: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
  [DealState.NoMatch]: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
  [DealState.Cancelled]: 'bg-slate-500/10 text-slate-400 ring-1 ring-slate-500/20',
  [DealState.Expired]: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
};

// ── Privara / ReineiraOS Escrow (direct contract calls) ─────────────

const ESCROW_ADDRESSES: Record<number, `0x${string}`> = {
  421614: '0xC4333F84F5034D8691CB95f068def2e3B6DC60Fa', // Arbitrum Sepolia
};

const CONF_USDC_ADDRESSES: Record<number, `0x${string}`> = {
  421614: '0x6b6e6479b8b3237933c3ab9d8be969862d4ed89f', // Arbitrum Sepolia
};

export function useEscrowAddress(): `0x${string}` | undefined {
  const chainId = useChainId();
  return ESCROW_ADDRESSES[chainId];
}

export function useConfUsdcAddress(): `0x${string}` | undefined {
  const chainId = useChainId();
  return CONF_USDC_ADDRESSES[chainId];
}

const IN_ITEM_TUPLE = {
  type: 'tuple' as const,
  components: [
    { name: 'ctHash', type: 'uint256' as const },
    { name: 'securityZone', type: 'uint8' as const },
    { name: 'utype', type: 'uint8' as const },
    { name: 'signature', type: 'bytes' as const },
  ],
};

export const ESCROW_ABI = [
  {
    name: 'create', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedOwner', ...IN_ITEM_TUPLE },
      { name: 'encryptedAmount', ...IN_ITEM_TUPLE },
      { name: 'resolver', type: 'address' },
      { name: 'resolverData', type: 'bytes' },
    ],
    outputs: [{ name: 'escrowId', type: 'uint256' }],
  },
  {
    name: 'fund', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'uint256' },
      { name: 'encryptedPayment', ...IN_ITEM_TUPLE },
    ],
    outputs: [],
  },
  {
    name: 'redeem', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [],
  },
  {
    anonymous: false, type: 'event', name: 'EscrowCreated',
    inputs: [{ indexed: true, name: 'escrowId', type: 'uint256' }],
  },
  {
    anonymous: false, type: 'event', name: 'EscrowFunded',
    inputs: [
      { indexed: true, name: 'escrowId', type: 'uint256' },
      { indexed: true, name: 'payer', type: 'address' },
    ],
  },
] as const;

export const CONF_USDC_ABI = [
  {
    name: 'setOperator', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'expiry', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'isOperator', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Convert a human-readable USDC amount to base units (6 decimals). */
export function usdcUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 1e6));
}

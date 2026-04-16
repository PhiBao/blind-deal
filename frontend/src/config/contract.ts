import { useChainId } from 'wagmi';

const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  421614: '0x6f7665a7aD14c5DAE617BFec7E80d616DA1Aab7A', // Arbitrum Sepolia
  11155111: '0x348e8E6Da1278a625B0B13Ff81a55D3AA614f4aD', // Ethereum Sepolia
};

// Fallback for when no wallet is connected (e.g. read-only views)
export const BLIND_DEAL_ADDRESS_FALLBACK = CONTRACT_ADDRESSES[421614];

export function useBlindDealAddress(): `0x${string}` {
  const chainId = useChainId();
  return CONTRACT_ADDRESSES[chainId] ?? BLIND_DEAL_ADDRESS_FALLBACK;
}

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
    inputs: [{ name: 'user', type: 'address' }], name: 'getUserDeals',
    outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view', type: 'function',
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
}

export const DEAL_STATE_LABELS: Record<DealState, string> = {
  [DealState.Open]: 'Open',
  [DealState.Matched]: 'Matched',
  [DealState.NoMatch]: 'No Match',
  [DealState.Cancelled]: 'Cancelled',
};

export const DEAL_STATE_COLORS: Record<DealState, string> = {
  [DealState.Open]: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
  [DealState.Matched]: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
  [DealState.NoMatch]: 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
  [DealState.Cancelled]: 'bg-slate-500/10 text-slate-400 ring-1 ring-slate-500/20',
};

// Escrow ID + status persistence per deal (localStorage)

const ESCROW_STORAGE_KEY = 'blinddeal_escrows';

interface EscrowData {
  id: string;
  status: 'none' | 'created' | 'linking' | 'linked' | 'funded' | 'redeemed';
  fundTxHash?: string;
  redeemTxHash?: string;
}

function getAll(): Record<string, EscrowData> {
  try {
    return JSON.parse(localStorage.getItem(ESCROW_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getStoredEscrowId(dealId: bigint, chainId: number): bigint | null {
  const data = getAll()[`${chainId}_${dealId}`];
  return data?.id != null ? BigInt(data.id) : null;
}

export function getStoredEscrowStatus(dealId: bigint, chainId: number): EscrowData['status'] {
  return getAll()[`${chainId}_${dealId}`]?.status ?? 'none';
}

export function getStoredFundTxHash(dealId: bigint, chainId: number): string | null {
  return getAll()[`${chainId}_${dealId}`]?.fundTxHash ?? null;
}

export function getStoredRedeemTxHash(dealId: bigint, chainId: number): string | null {
  return getAll()[`${chainId}_${dealId}`]?.redeemTxHash ?? null;
}

export function storeEscrowData(
  dealId: bigint,
  chainId: number,
  data: Partial<EscrowData>,
) {
  try {
    const all = getAll();
    const key = `${chainId}_${dealId}`;
    all[key] = { ...all[key], ...data } as EscrowData;
    localStorage.setItem(ESCROW_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function storeEscrowId(dealId: bigint, chainId: number, escrowId: bigint) {
  storeEscrowData(dealId, chainId, { id: escrowId.toString() });
}

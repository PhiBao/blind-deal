// Escrow ID persistence per deal (localStorage)

const ESCROW_STORAGE_KEY = 'blinddeal_escrows';

export function getStoredEscrowId(dealId: bigint, chainId: number): bigint | null {
  try {
    const data = JSON.parse(localStorage.getItem(ESCROW_STORAGE_KEY) || '{}');
    const val = data[`${chainId}_${dealId}`];
    return val != null ? BigInt(val) : null;
  } catch {
    return null;
  }
}

export function storeEscrowId(dealId: bigint, chainId: number, escrowId: bigint) {
  try {
    const data = JSON.parse(localStorage.getItem(ESCROW_STORAGE_KEY) || '{}');
    data[`${chainId}_${dealId}`] = escrowId.toString();
    localStorage.setItem(ESCROW_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

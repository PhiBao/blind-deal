import { useState, useEffect, useCallback, useRef } from 'react';
import { useWalletClient, useChainId } from 'wagmi';
import { ReineiraSDK, walletClientToSigner } from '@reineira-os/sdk';

export function useReineiraSDK() {
  const { data: walletClient } = useWalletClient();
  const [sdk, setSdk] = useState<ReineiraSDK | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletRef = useRef<string | null>(null);

  useEffect(() => {
    if (!walletClient) {
      setSdk(null);
      walletRef.current = null;
      return;
    }

    const addr = walletClient.account.address;
    if (walletRef.current === addr) return;
    walletRef.current = addr;

    let cancelled = false;

    async function init() {
      setIsInitializing(true);
      setError(null);
      try {
        const signer = await walletClientToSigner(walletClient as any);
        const instance = ReineiraSDK.create({
          network: 'testnet',
          signer,
        });
        await instance.initialize();
        if (!cancelled) setSdk(instance);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'SDK init failed');
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [walletClient]);

  return { sdk, isInitializing, error };
}

// --- Escrow ID persistence per deal ---

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

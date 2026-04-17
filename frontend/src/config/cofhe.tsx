import { useEffect, useRef } from 'react';
import { CofheProvider, createCofheConfig, useCofheConnection, useCofheClient, useCofheActivePermit } from '@cofhe/react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { sepolia, arbSepolia } from '@cofhe/sdk/chains';

const cofheConfig = createCofheConfig({
  supportedChains: [sepolia, arbSepolia],
});

/** Auto-creates a self permit when CoFHE is connected but no active permit exists. */
function AutoPermit() {
  const cofheClient = useCofheClient();
  const { connected, account } = useCofheConnection();
  const activePermit = useCofheActivePermit();
  const creating = useRef(false);

  useEffect(() => {
    if (!connected || !account || activePermit || creating.current) return;
    creating.current = true;

    cofheClient.permits
      .createSelf({ issuer: account, name: 'BlindDeal Auto' })
      .then(() => { creating.current = false; })
      .catch((err) => {
        console.warn('[BlindDeal] Auto-permit creation failed:', err);
        creating.current = false;
      });
  }, [connected, account, activePermit, cofheClient]);

  return null;
}

export function CofheProviderWrapper({ children }: { children: React.ReactNode }) {
  const wagmiPublicClient = usePublicClient();
  const { chain, status, connector } = useAccount();

  // Guard: only enable wallet client query when the connector is fully hydrated
  // On page reload, wagmi restores state from localStorage with dead connector objects
  // (plain objects without methods like getChainId). The reconnect() action fixes them,
  // but useWalletClient fires before that. Check for a real method to detect hydration.
  const isConnectorReady = status === 'connected' && !!connector && typeof connector.getChainId === 'function';

  const { data: wagmiWalletClient } = useWalletClient({
    query: { enabled: isConnectorReady },
  });

  const isReady = isConnectorReady && chain !== undefined;

  return (
    <CofheProvider
      walletClient={isReady ? wagmiWalletClient : undefined}
      publicClient={isReady ? wagmiPublicClient : undefined}
      config={cofheConfig}
    >
      <AutoPermit />
      {children}
    </CofheProvider>
  );
}

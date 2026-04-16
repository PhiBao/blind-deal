import { CofheProvider, createCofheConfig } from '@cofhe/react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { sepolia, arbSepolia } from '@cofhe/sdk/chains';

const cofheConfig = createCofheConfig({
  supportedChains: [sepolia, arbSepolia],
});

export function CofheProviderWrapper({ children }: { children: React.ReactNode }) {
  const wagmiPublicClient = usePublicClient();
  const { data: wagmiWalletClient } = useWalletClient();
  const { chain } = useAccount();

  const isConnected = chain !== undefined;

  return (
    <CofheProvider
      walletClient={isConnected ? wagmiWalletClient : undefined}
      publicClient={isConnected ? wagmiPublicClient : undefined}
      config={cofheConfig}
    >
      {children}
    </CofheProvider>
  );
}

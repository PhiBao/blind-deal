import { http, createConfig, injected } from 'wagmi';
import { arbitrumSepolia, sepolia } from 'wagmi/chains';

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia, sepolia],
  transports: {
    [arbitrumSepolia.id]: http(),
    [sepolia.id]: http(),
  },
  connectors: [injected({ shimDisconnect: true })],
  ssr: false,
  syncConnectedChain: true,
});

import { http, createConfig, injected } from 'wagmi';
import { arbitrumSepolia, sepolia } from 'wagmi/chains';

// Clear dead connector objects from wagmi persistence before the store hydrates.
// wagmi serializes connectors as plain {id, name, type, uid} — no methods.
// On reload, these dead objects end up in the connections Map and cause
// "connector.getChainId is not a function" errors. Clearing them here forces
// reconnect() to create fresh live connectors. The shimDisconnect flag
// (wagmi.injected.shimDisconnect) is stored separately and preserved,
// so auto-reconnection still works.
try {
  const raw = localStorage.getItem('wagmi.store');
  if (raw) {
    const data = JSON.parse(raw);
    if (data?.state?.connections) {
      data.state.connections = { __type: 'Map', value: [] };
      data.state.current = null;
      localStorage.setItem('wagmi.store', JSON.stringify(data));
    }
  }
} catch {}

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia, sepolia],
  transports: {
    [arbitrumSepolia.id]: http(),
    [sepolia.id]: http(),
  },
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  ssr: false,
  syncConnectedChain: true,
});

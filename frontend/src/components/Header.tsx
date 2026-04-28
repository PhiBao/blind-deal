import { useState, useRef, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useChainId, useSwitchChain } from 'wagmi';
import { disconnect as disconnectCore } from 'wagmi/actions';
import { useQueryClient } from '@tanstack/react-query';
import { arbitrumSepolia, sepolia } from 'wagmi/chains';
import { wagmiConfig } from '../config/wagmi';

const CHAINS = [
  { id: arbitrumSepolia.id, name: 'Arb Sepolia', color: 'bg-sky-400' },
  { id: sepolia.id, name: 'Eth Sepolia', color: 'bg-violet-400' },
] as const;

interface HeaderProps {
  onNavigate: (page: 'dashboard' | 'create') => void;
  currentPage: string;
}

export function Header({ onNavigate, currentPage }: HeaderProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const chainMenuRef = useRef<HTMLDivElement>(null);
  const walletModalRef = useRef<HTMLDivElement>(null);
  const currentChain = CHAINS.find((c) => c.id === chainId) ?? CHAINS[0];

  // Deduplicate connectors: prefer EIP-6963 (has icon/name) over generic injected fallback
  const uniqueConnectors = connectors.reduce<typeof connectors[number][]>((acc, c) => {
    if (c.type === 'injected' && !c.icon && acc.some((a) => a.id === c.id)) return acc;
    if (!acc.some((a) => a.id === c.id && a.type === c.type)) acc.push(c);
    return acc;
  }, []);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      await disconnectCore(wagmiConfig);
    } catch {
      // connector.disconnect() may not exist for injected connectors
      // Force-reset wagmi internal state
      wagmiConfig.setState((x: any) => ({
        ...x,
        connections: new Map(),
        current: null,
        status: 'disconnected',
      }));
    }
    // Clear wagmi persisted storage so it won't auto-reconnect
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('wagmi')) localStorage.removeItem(key);
    }
    queryClient.clear();
    setIsDisconnecting(false);
  }, [queryClient]);

  // Close chain dropdown on outside click
  useEffect(() => {
    if (!showChainMenu) return;
    function handleClick(e: MouseEvent) {
      if (chainMenuRef.current && !chainMenuRef.current.contains(e.target as Node)) {
        setShowChainMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showChainMenu]);

  // Close wallet modal on outside click
  useEffect(() => {
    if (!showWalletModal) return;
    function handleClick(e: MouseEvent) {
      if (walletModalRef.current && !walletModalRef.current.contains(e.target as Node)) {
        setShowWalletModal(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showWalletModal]);

  return (
    <header className="border-b border-white/5 bg-white/[0.02] backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-indigo-500/20">
              B
            </div>
            <span className="text-base font-semibold text-white tracking-tight hidden sm:inline">
              BlindDeal
            </span>
          </button>

          <nav className="flex gap-1 ml-2">
            <button
              onClick={() => onNavigate('dashboard')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                currentPage === 'dashboard'
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Deals
            </button>
            <button
              onClick={() => onNavigate('create')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                currentPage === 'create'
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              + New
            </button>
          </nav>
        </div>

        <div>
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className="relative" ref={chainMenuRef}>
                <button
                  onClick={() => setShowChainMenu((v) => !v)}
                  disabled={isSwitching}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors text-sm text-slate-300 disabled:opacity-50"
                >
                  {isSwitching ? (
                    <span className="inline-block w-2 h-2 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className={`w-2 h-2 rounded-full ${currentChain.color}`} />
                  )}
                  <span className="hidden sm:inline">{currentChain.name}</span>
                  <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showChainMenu && (
                  <div className="absolute right-0 mt-1 w-44 rounded-xl bg-[#151a2b] border border-white/10 shadow-xl z-50 py-1">
                    {CHAINS.map((c) => (
                      <button
                        key={c.id}
                        disabled={isSwitching}
                        onClick={() => {
                          if (c.id !== chainId) switchChain({ chainId: c.id });
                          setShowChainMenu(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                          c.id === chainId ? 'text-white bg-white/5' : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full ${c.color}`} />
                        {c.name}
                        {c.id === chainId && <span className="ml-auto text-xs text-emerald-400">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-slate-300 font-mono">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="px-2.5 py-1.5 text-sm text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50"
                title="Disconnect wallet"
              >
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowWalletModal(true)}
              disabled={isConnecting}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-medium rounded-lg hover:from-indigo-500 hover:to-violet-500 transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Wallet selection modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div
            ref={walletModalRef}
            className="w-full max-w-sm rounded-2xl bg-[#151a2b] border border-white/10 shadow-2xl p-5 relative top-0"
            style={{ marginTop: 'auto', marginBottom: 'auto' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Connect Wallet</h3>
              <button
                onClick={() => setShowWalletModal(false)}
                className="text-slate-400 hover:text-white transition-colors p-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {uniqueConnectors.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-white font-medium mb-1">No Wallet Detected</p>
                <p className="text-sm text-slate-400 mb-4">Install a browser wallet extension to continue.</p>
                <div className="flex flex-col gap-2">
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-500 transition-colors"
                  >
                    Install MetaMask
                  </a>
                  <a
                    href="https://rabby.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white/[0.06] text-slate-300 text-sm rounded-xl hover:bg-white/[0.1] transition-colors"
                  >
                    Install Rabby
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {uniqueConnectors.map((c) => (
                  <button
                    key={`${c.id}-${c.uid}`}
                    disabled={isConnecting}
                    onClick={() => {
                      connect({ connector: c });
                      setShowWalletModal(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                  >
                    {c.icon ? (
                      <img src={c.icon} alt="" className="w-8 h-8 rounded-lg" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                        <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-white font-medium">{c.name}</p>
                      <p className="text-xs text-slate-500">{c.type === 'injected' ? 'Browser Extension' : c.type}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

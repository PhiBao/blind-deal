import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import { WagmiProvider, useAccount, useChainId, useSwitchChain } from 'wagmi';
import { arbitrumSepolia, sepolia } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config/wagmi';
import { CofheProviderWrapper } from './config/cofhe.js';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { CreateDeal } from './components/CreateDeal';
import { DealDetail } from './components/DealDetail';
import { MCPServer } from './components/MCPServer';
import { DealToastContext } from './components/DealDetail';
import { useToast, ToastContainer } from './components/Toast';

const queryClient = new QueryClient();

export type View = { page: 'dashboard' } | { page: 'create' } | { page: 'deal'; dealId: bigint } | { page: 'mcp' };

const SUPPORTED_CHAIN_IDS: number[] = [arbitrumSepolia.id, sepolia.id];

/* -------------------------------------------------- */
/* Error Boundary                                      */
/* -------------------------------------------------- */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[BlindDeal] Uncaught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center px-4">
          <div className="glass rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-white font-medium mb-1">Something went wrong</p>
            <p className="text-sm text-slate-400 mb-4">Please refresh the page to continue.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-500 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* -------------------------------------------------- */
/* Chain Guard                                         */
/* -------------------------------------------------- */
function ChainGuard({ children }: { children: ReactNode }) {
  const { isConnected, chain } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  // Auto-switch to Arbitrum Sepolia when connected to unsupported chain
  useEffect(() => {
    if (isConnected && !SUPPORTED_CHAIN_IDS.includes(chainId)) {
      switchChain({ chainId: arbitrumSepolia.id });
    }
  }, [isConnected, chainId, switchChain]);

  if (isConnected && !SUPPORTED_CHAIN_IDS.includes(chainId)) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-white font-medium mb-1">Unsupported Network</p>
          <p className="text-sm text-slate-400 mb-1">Connected to: <span className="text-slate-300">{chain?.name ?? `Chain ${chainId}`}</span></p>
          <p className="text-sm text-slate-400 mb-4">Switch to Arbitrum Sepolia or Ethereum Sepolia to use BlindDeal.</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => switchChain({ chainId: arbitrumSepolia.id })}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-500 transition-colors"
            >
              Switch to Arbitrum Sepolia
            </button>
            <button
              onClick={() => switchChain({ chainId: sepolia.id })}
              className="px-4 py-2 bg-white/[0.06] text-slate-300 text-sm rounded-xl hover:bg-white/[0.1] transition-colors"
            >
              Switch to Ethereum Sepolia
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/* -------------------------------------------------- */
/* App Content                                         */
/* -------------------------------------------------- */
function AppContent() {
  const [view, setView] = useState<View>({ page: 'dashboard' });
  const { toasts, toast, update, dismiss } = useToast();

  // Deep-link: ?deal=123 opens that deal, ?action=mcp opens MCP page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealParam = params.get('deal');
    const action = params.get('action');
    if (dealParam) {
      try {
        setView({ page: 'deal', dealId: BigInt(dealParam) });
      } catch {}
    } else if (action === 'mcp') {
      setView({ page: 'mcp' });
    }
  }, []);

  // Sync URL with current view for refresh persistence
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view.page === 'deal' && view.dealId != null) {
      url.searchParams.set('deal', view.dealId.toString());
      url.searchParams.delete('action');
    } else if (view.page === 'mcp') {
      url.searchParams.set('action', 'mcp');
      url.searchParams.delete('deal');
    } else {
      url.searchParams.delete('deal');
      url.searchParams.delete('action');
    }
    window.history.replaceState({}, '', url.toString());
  }, [view]);

  return (
    <DealToastContext.Provider value={{ toast, update }}>
      <div className="min-h-screen bg-[#0b0f1a] relative overflow-hidden">
        {/* Background gradient orbs */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 -left-40 w-80 h-80 bg-violet-600/8 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 right-1/3 w-72 h-72 bg-indigo-500/5 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10">
          <Header
            onNavigate={(page) => setView({ page } as View)}
            currentPage={view.page}
          />
          <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            {view.page === 'dashboard' && (
              <Dashboard
                onSelectDeal={(id) => setView({ page: 'deal', dealId: id })}
                onNavigate={(page) => setView({ page } as View)}
              />
            )}
            {view.page === 'create' && (
              <CreateDeal onCreated={(id) => setView({ page: 'deal', dealId: id })} />
            )}
            {view.page === 'deal' && (
              <DealDetail
                key={`deal-${view.dealId?.toString()}`}
                dealId={view.dealId}
                onBack={() => setView({ page: 'dashboard' })}
              />
            )}
            {view.page === 'mcp' && (
              <MCPServer
                onNavigate={(page) => setView({ page } as View)}
                currentPage={view.page}
              />
            )}
          </main>
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    </DealToastContext.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <CofheProviderWrapper>
            <ChainGuard>
              <AppContent />
            </ChainGuard>
          </CofheProviderWrapper>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  );
}

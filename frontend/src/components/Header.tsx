import { useAccount, useConnect, useDisconnect } from 'wagmi';

interface HeaderProps {
  onNavigate: (page: 'dashboard' | 'create') => void;
  currentPage: string;
}

export function Header({ onNavigate, currentPage }: HeaderProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

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
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-slate-300 font-mono">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
              <button
                onClick={() => disconnect()}
                className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-medium rounded-lg hover:from-indigo-500 hover:to-violet-500 transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

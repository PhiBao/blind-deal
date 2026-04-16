import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { BLIND_DEAL_ABI, useBlindDealAddress, DealState, DEAL_STATE_LABELS, DEAL_STATE_COLORS } from '../config/contract';

interface DashboardProps {
  onSelectDeal: (dealId: bigint) => void;
  onNavigate: (page: 'dashboard' | 'create') => void;
}

export function Dashboard({ onSelectDeal, onNavigate }: DashboardProps) {
  const { address, isConnected } = useAccount();
  const contractAddress = useBlindDealAddress();

  const { data: userDealIds, isLoading } = useReadContract({
    address: contractAddress,
    abi: BLIND_DEAL_ABI,
    functionName: 'getUserDeals',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (!isConnected) {
    return <HeroSection onNavigate={onNavigate} showConnect />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-xl p-5 shimmer h-24" />
        ))}
      </div>
    );
  }

  const dealIds = userDealIds ?? [];

  if (dealIds.length === 0) {
    return <HeroSection onNavigate={onNavigate} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">My Deals</h2>
        <span className="text-sm text-slate-500">{dealIds.length} deal{dealIds.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-3">
        {[...dealIds].reverse().map((dealId) => (
          <DealRow key={dealId.toString()} dealId={dealId} onSelect={onSelectDeal} currentUser={address!} />
        ))}
      </div>
    </div>
  );
}

function HeroSection({ onNavigate, showConnect }: { onNavigate: (page: 'dashboard' | 'create') => void; showConnect?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24">
      {/* Logo */}
      <div className="animate-float mb-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-600/30 animate-pulse-glow">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
      </div>

      <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 text-center">
        Confidential Price<br />
        <span className="gradient-text">Negotiation</span>
      </h1>
      <p className="text-slate-400 text-center max-w-md mb-8 leading-relaxed">
        Negotiate deals where prices stay encrypted with FHE. If both parties&#39; ranges overlap, the deal closes at the midpoint — no price is ever exposed.
      </p>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-2 mb-10">
        {['FHE Encrypted', 'Zero Knowledge', 'Fair Midpoint', 'Privacy First'].map((f) => (
          <span key={f} className="px-3 py-1 text-xs font-medium text-indigo-300 bg-indigo-500/10 rounded-full ring-1 ring-indigo-500/20">
            {f}
          </span>
        ))}
      </div>

      {showConnect ? (
        <p className="text-sm text-slate-500">Connect your wallet to get started</p>
      ) : (
        <button
          onClick={() => onNavigate('create')}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-xl hover:from-indigo-500 hover:to-violet-500 transition-all shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40 hover:-translate-y-0.5"
        >
          Create Your First Deal →
        </button>
      )}
    </div>
  );
}

function DealRow({ dealId, onSelect, currentUser }: { dealId: bigint; onSelect: (id: bigint) => void; currentUser: `0x${string}` }) {
  const contractAddress = useBlindDealAddress();
  const { data: results } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDeadline', args: [dealId] },
    ],
  });

  if (!results || results.some(r => r.status === 'failure')) {
    return <div className="glass rounded-xl p-5 shimmer h-20" />;
  }

  const state = results[0].result as number;
  const [buyer, seller] = results[1].result as [string, string];
  const description = results[2].result as string;
  const [buyerDone, sellerDone] = results[3].result as [boolean, boolean];
  const deadline = results[4].result as bigint;

  const isBuyer = currentUser.toLowerCase() === buyer.toLowerCase();
  const role = isBuyer ? 'Buyer' : 'Seller';

  const isExpired = deadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > deadline;

  return (
    <button
      onClick={() => onSelect(dealId)}
      className="w-full text-left glass rounded-xl p-4 glass-hover transition-all group"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold text-white">#{dealId.toString()}</span>
            <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full ${DEAL_STATE_COLORS[state as DealState]}`}>
              {DEAL_STATE_LABELS[state as DealState]}
            </span>
            <span className="text-[11px] text-indigo-400 font-medium px-1.5 py-0.5 rounded bg-indigo-500/10">
              {role}
            </span>
          </div>
          <p className="text-sm text-slate-300 truncate mb-2">{description}</p>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${buyerDone ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              Buyer
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${sellerDone ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              Seller
            </span>
            {deadline > 0n && (
              <span className={isExpired ? 'text-red-400' : ''}>
                {isExpired ? 'Expired' : `Due ${new Date(Number(deadline) * 1000).toLocaleDateString()}`}
              </span>
            )}
          </div>
        </div>
        <span className="text-slate-600 group-hover:text-indigo-400 transition-colors text-lg mt-1">→</span>
      </div>
    </button>
  );
}

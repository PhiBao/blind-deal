import { useState } from 'react';
import { useAccount, useReadContract, useReadContracts, useChainId } from 'wagmi';
import { BLIND_DEAL_ABI, useBlindDealAddress, DealState, DealType, DEAL_STATE_LABELS, DEAL_STATE_COLORS } from '../config/contract';

type Tab = 'my-deals' | 'marketplace';

interface DashboardProps {
  onSelectDeal: (dealId: bigint) => void;
  onNavigate: (page: 'dashboard' | 'create') => void;
}

export function Dashboard({ onSelectDeal, onNavigate }: DashboardProps) {
  const { address, isConnected } = useAccount();
  const contractAddress = useBlindDealAddress();
  const [activeTab, setActiveTab] = useState<Tab>('my-deals');

  const { data: userDealIds, isLoading: myLoading } = useReadContract({
    address: contractAddress,
    abi: BLIND_DEAL_ABI,
    functionName: 'getUserDeals',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  const { data: dealCount, isLoading: countLoading } = useReadContract({
    address: contractAddress,
    abi: BLIND_DEAL_ABI,
    functionName: 'dealCount',
    query: { refetchInterval: 30000 },
  });

  if (!isConnected) {
    return <HeroSection onNavigate={onNavigate} showConnect />;
  }

  const myDeals = (userDealIds ?? []) as bigint[];
  const totalDeals = dealCount ?? 0n;

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
        <button
          onClick={() => setActiveTab('my-deals')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'my-deals'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          My Deals {myDeals.length > 0 && `(${myDeals.length})`}
        </button>
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeTab === 'marketplace'
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Marketplace
        </button>
      </div>

      {activeTab === 'my-deals' && (
        <MyDealsView
          myDeals={myDeals}
          isLoading={myLoading}
          onSelectDeal={onSelectDeal}
          onNavigate={onNavigate}
          currentUser={address!}
        />
      )}

      {activeTab === 'marketplace' && (
        <MarketplaceView
          totalDeals={totalDeals}
          isLoading={countLoading}
          onSelectDeal={onSelectDeal}
          currentUser={address!}
        />
      )}
    </div>
  );
}

type Filter = 'all' | 'open' | 'closed';

function MyDealsView({
  myDeals,
  isLoading,
  onSelectDeal,
  onNavigate,
  currentUser,
}: {
  myDeals: bigint[];
  isLoading: boolean;
  onSelectDeal: (id: bigint) => void;
  onNavigate: (page: 'dashboard' | 'create') => void;
  currentUser: `0x${string}`;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const contractAddress = useBlindDealAddress();

  const { data: states } = useReadContracts({
    contracts: myDeals.map((id) => ({
      address: contractAddress,
      abi: BLIND_DEAL_ABI,
      functionName: 'getDealState',
      args: [id],
    })),
    query: { enabled: myDeals.length > 0, refetchInterval: 15000 },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-xl p-5 shimmer h-24" />
        ))}
      </div>
    );
  }

  if (myDeals.length === 0) {
    return <HeroSection onNavigate={onNavigate} />;
  }

  const stateMap = new Map<bigint, number>();
  if (states) {
    myDeals.forEach((id, i) => {
      const s = states[i];
      if (s.status === 'success') stateMap.set(id, Number(s.result));
    });
  }

  const isOpenState = (s: number) => s === DealState.Open;
  const isClosedState = (s: number) => !isOpenState(s);

  const filteredDeals = [...myDeals].reverse().filter((id) => {
    const s = stateMap.get(id) ?? DealState.Open;
    if (filter === 'open') return isOpenState(s);
    if (filter === 'closed') return isClosedState(s);
    return true;
  });

  const openCount = [...myDeals].filter((id) => isOpenState(stateMap.get(id) ?? DealState.Open)).length;
  const closedCount = myDeals.length - openCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">My Deals</h2>
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-0.5">
          {(['all', 'open', 'closed'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f === 'all' ? 'All' : f === 'open' ? `Open (${openCount})` : `Closed (${closedCount})`}
            </button>
          ))}
        </div>
      </div>

      {filteredDeals.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No {filter} deals found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDeals.map((dealId) => (
            <DealRow key={dealId.toString()} dealId={dealId} onSelect={onSelectDeal} currentUser={currentUser} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceView({
  totalDeals,
  isLoading,
  onSelectDeal,
  currentUser,
}: {
  totalDeals: bigint;
  isLoading: boolean;
  onSelectDeal: (id: bigint) => void;
  currentUser: `0x${string}`;
}) {
  const contractAddress = useBlindDealAddress();
  const chainId = useChainId();
  const [stateFilter, setStateFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(20);
  const PAGE_SIZE = 20;

  const explorerUrl = chainId === 421614
    ? 'https://sepolia.arbiscan.io'
    : 'https://sepolia.etherscan.io';

  const dealIds: bigint[] = [];
  const maxShow = BigInt(Math.max(Number(totalDeals), visibleLimit));
  const start = totalDeals > maxShow ? totalDeals - maxShow : 0n;
  for (let i = totalDeals - 1n; i >= start; i--) {
    dealIds.push(i);
  }

  const { data: batchResults } = useReadContracts({
    contracts: dealIds.flatMap((id) => [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [id] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [id] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [id] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealType', args: [id] },
    ]),
    query: { enabled: dealIds.length > 0, refetchInterval: 15000 },
  });

  if (isLoading || !batchResults) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass rounded-xl p-5 shimmer h-20" />
        ))}
      </div>
    );
  }

  interface DealEntry {
    id: bigint; state: number; buyer: string; seller: string;
    description: string; dealType: number;
  }

  const allDeals: DealEntry[] = [];
  for (let i = 0; i < dealIds.length; i++) {
    const stateResult = batchResults[i * 4];
    const partiesResult = batchResults[i * 4 + 1];
    const descResult = batchResults[i * 4 + 2];
    const typeResult = batchResults[i * 4 + 3];
    if (stateResult?.status !== 'success' || partiesResult?.status !== 'success') continue;
    const [buyer, seller] = partiesResult.result as unknown as [string, string];
    allDeals.push({
      id: dealIds[i],
      state: Number(stateResult.result),
      buyer, seller,
      description: String(descResult?.result ?? ''),
      dealType: Number(typeResult?.result ?? 0),
    });
  }

  let filtered = allDeals;
  if (stateFilter !== null) {
    filtered = filtered.filter((d) => d.state === stateFilter);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim();
    const qLower = q.toLowerCase();
    filtered = filtered.filter((d) =>
      d.id.toString() === q ||
      d.description.toLowerCase().includes(qLower) ||
      d.buyer.toLowerCase().includes(qLower) ||
      d.seller.toLowerCase().includes(qLower)
    );
  }

  const isOpenForSellers = (d: DealEntry) =>
    d.dealType === DealType.Open &&
    d.seller === '0x0000000000000000000000000000000000000000';

  const isParticipating = (d: DealEntry) =>
    currentUser.toLowerCase() === d.buyer.toLowerCase() ||
    currentUser.toLowerCase() === d.seller.toLowerCase();

  if (filtered.length === 0 && !searchQuery && stateFilter === null) {
    return (
      <div className="text-center py-12">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
        </div>
        <p className="text-white font-medium mb-1">No Deals in Marketplace</p>
        <p className="text-sm text-slate-400 mb-6">Be the first to create a negotiation deal!</p>
      </div>
    );
  }

  const handles = (d: DealEntry) => {
    onSelectDeal(d.id);
  };

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="space-y-3 mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by deal ID, description, or address..."
            className="w-full pl-9 pr-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setStateFilter(null)}
            className={`shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
              stateFilter === null ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200 bg-white/[0.03]'
            }`}
          >
            All ({allDeals.length})
          </button>
          {[DealState.Open, DealState.Matched, DealState.NoMatch, DealState.Cancelled, DealState.Expired].map((s) => {
            const count = allDeals.filter((d) => d.state === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setStateFilter(stateFilter === s ? null : s)}
                className={`shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                  stateFilter === s ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200 bg-white/[0.03]'
                }`}
              >
                {DEAL_STATE_LABELS[s as DealState]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-10">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-500/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm text-slate-400">No deals match your search.</p>
          <button
            onClick={() => { setSearchQuery(''); setStateFilter(null); }}
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((deal) => (
            <button
              key={deal.id.toString()}
              onClick={() => handles(deal)}
              className="w-full text-left glass rounded-xl p-4 glass-hover transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-white">#{deal.id.toString()}</span>
                    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full ${DEAL_STATE_COLORS[deal.state as DealState]}`}>
                      {DEAL_STATE_LABELS[deal.state as DealState]}
                    </span>
                    {isOpenForSellers(deal) && (
                      <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                        Open for sellers
                      </span>
                    )}
                    {deal.dealType === DealType.Direct && (
                      <span className="text-[11px] text-slate-500 font-medium">Direct</span>
                    )}
                    {isParticipating(deal) && (
                      <span className="text-[11px] text-indigo-400 font-medium">You</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 truncate mb-2">{deal.description}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="font-mono">Buyer: {deal.buyer.slice(0, 6)}...{deal.buyer.slice(-4)}</span>
                    <span className="font-mono">Seller: {
                      isOpenForSellers(deal)
                        ? <span className="text-emerald-400">Open slot</span>
                        : `${deal.seller.slice(0, 6)}...${deal.seller.slice(-4)}`
                    }</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                  <span className="text-slate-600 group-hover:text-indigo-400 transition-colors text-lg">→</span>
                  <a
                    href={`${explorerUrl}/address/${contractAddress}?dealId=${deal.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-slate-600 hover:text-indigo-400 transition-colors"
                  >
                    Explorer ↗
                  </a>
                </div>
              </div>
            </button>
          ))}

          {/* Load More */}
          {visibleLimit < Number(totalDeals) && (
            <button
              onClick={() => setVisibleLimit((prev) => prev + PAGE_SIZE)}
              className="w-full py-3 text-sm text-indigo-400 border border-white/[0.06] rounded-xl hover:bg-white/[0.04] transition-colors"
            >
              Load More ({Math.min(PAGE_SIZE, Number(totalDeals) - visibleLimit)} more)
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-xs text-slate-600">
        <span>Showing {filtered.length} of {allDeals.length} deals</span>
        <span>Total: {totalDeals.toString()}</span>
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
        {['FHE Encrypted', 'Condition Escrow', 'Explorer Verified', 'Privacy First'].map((f) => (
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
  const chainId = useChainId();
  const { data: results } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDeadline', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealType', args: [dealId] },
    ],
    query: {
      staleTime: 0,
      gcTime: 0,
      placeholderData: undefined,
    },
  });

  if (!results || results.some(r => r.status === 'failure')) {
    return <div className="glass rounded-xl p-5 shimmer h-20" />;
  }

  const state = results[0].result as number;
  const [buyer, seller] = results[1].result as [string, string];
  const description = results[2].result as string;
  const [buyerDone, sellerDone] = results[3].result as [boolean, boolean];
  const deadline = results[4].result as bigint;
  const dealType = results[5].result as number;

  const isBuyer = currentUser.toLowerCase() === buyer.toLowerCase();
  const role = isBuyer ? 'Buyer' : 'Seller';
  const isOpenDeal = dealType === DealType.Open;
  const isSellerSlotOpen = isOpenDeal && seller === '0x0000000000000000000000000000000000000000';
  const isExpired = deadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > deadline;

  const explorerUrl = chainId === 421614
    ? 'https://sepolia.arbiscan.io'
    : 'https://sepolia.etherscan.io';

  return (
    <button
      onClick={() => onSelect(dealId)}
      className="w-full text-left glass rounded-xl p-4 glass-hover transition-all group"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-sm font-semibold text-white">#{dealId.toString()}</span>
            <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full ${DEAL_STATE_COLORS[state as DealState]}`}>
              {DEAL_STATE_LABELS[state as DealState]}
            </span>
            <span className="text-[11px] text-indigo-400 font-medium px-1.5 py-0.5 rounded bg-indigo-500/10">
              {role}
            </span>
            {isSellerSlotOpen && (
              <span className="text-[11px] text-emerald-400 font-medium px-1.5 py-0.5 rounded bg-emerald-500/10">
                Joinable
              </span>
            )}
            {isOpenDeal && !isSellerSlotOpen && (
              <span className="text-[11px] text-slate-500 font-medium">Open Deal</span>
            )}
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
        <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
          <span className="text-slate-600 group-hover:text-indigo-400 transition-colors text-lg">→</span>
          <a
            href={`${explorerUrl}/address/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-slate-600 hover:text-indigo-400 transition-colors"
          >
            Explorer ↗
          </a>
        </div>
      </div>
    </button>
  );
}

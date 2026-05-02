import { useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { BLIND_DEAL_ABI, useBlindDealAddress, DealState, DEAL_STATE_LABELS, DEAL_STATE_COLORS } from '../config/contract';

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

  // Generate deal IDs: show latest 30 deals in reverse order
  const dealIds: bigint[] = [];
  const maxShow = 30n;
  const start = totalDeals > maxShow ? totalDeals - maxShow : 0n;
  for (let i = totalDeals - 1n; i >= start; i--) {
    dealIds.push(i);
  }

  const { data: batchResults } = useReadContracts({
    contracts: dealIds.flatMap((id) => [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [id] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [id] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [id] },
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

  const openDeals: { id: bigint; description: string; buyer: string; seller: string }[] = [];

  for (let i = 0; i < dealIds.length; i++) {
    const stateResult = batchResults[i * 3];
    const partiesResult = batchResults[i * 3 + 1];
    const descResult = batchResults[i * 3 + 2];

    if (stateResult.status !== 'success' || partiesResult.status !== 'success') continue;

    const state = Number(stateResult.result);
    const [buyer, seller] = partiesResult.result as unknown as [string, string];
    const description = String(descResult.result ?? '');

    // Only show Open deals that the current user is NOT part of
    if (state === DealState.Open) {
      const isParticipant =
        currentUser.toLowerCase() === buyer.toLowerCase() ||
        currentUser.toLowerCase() === seller.toLowerCase();
      if (!isParticipant) {
        openDeals.push({ id: dealIds[i], description, buyer, seller });
      }
    }
  }

  if (openDeals.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <p className="text-white font-medium mb-1">No Open Deals</p>
        <p className="text-sm text-slate-400">The marketplace is empty right now. Check back later!</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Open Marketplace</h2>
        <span className="text-sm text-slate-500">{openDeals.length} deal{openDeals.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-3">
        {openDeals.map((deal) => (
          <button
            key={deal.id.toString()}
            onClick={() => onSelectDeal(deal.id)}
            className="w-full text-left glass rounded-xl p-4 glass-hover transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-white">#{deal.id.toString()}</span>
                  <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20">
                    Open
                  </span>
                </div>
                <p className="text-sm text-slate-300 truncate mb-2">{deal.description}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="font-mono">Buyer: {deal.buyer.slice(0, 6)}...{deal.buyer.slice(-4)}</span>
                  <span className="font-mono">Seller: {deal.seller.slice(0, 6)}...{deal.seller.slice(-4)}</span>
                </div>
              </div>
              <span className="text-slate-600 group-hover:text-indigo-400 transition-colors text-lg mt-1">→</span>
            </div>
          </button>
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
  const { data: results } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDeadline', args: [dealId] },
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

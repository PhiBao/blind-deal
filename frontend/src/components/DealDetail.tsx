import { useState, useEffect, createContext, useContext } from 'react';
import {
  useAccount,
  useReadContracts,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  usePublicClient,
} from 'wagmi';
import { useCofheEncrypt, useCofheClient, useCofheConnection } from '@cofhe/react';
import { Encryptable, FheTypes } from '@cofhe/sdk';
import { createWalletClient, custom, type Account, type Chain, type Transport } from 'viem';
import { sepolia, arbitrumSepolia } from 'viem/chains';
import {
  BLIND_DEAL_ABI,
  useBlindDealAddress,
  useResolverAddress,
  RESOLVER_ABI,
  ESCROW_ABI,
  useEscrowAddress,
  DealState,
  DEAL_STATE_LABELS,
  DEAL_STATE_COLORS,
} from '../config/contract';
import { getStoredEscrowId, storeEscrowId } from '../hooks/useEscrow';
import { bridgeUSDCViaCCTP, receiveCCTPMessageOnArbitrum } from '../utils/cctp';
import type { ToastType } from './Toast';

// ── Toast context (provided by App) ─────────────────────────────────

interface ToastCtx {
  toast: (type: ToastType, msg: string, duration?: number) => number;
  update: (id: number, type: ToastType, msg: string, duration?: number) => void;
}
export const DealToastContext = createContext<ToastCtx>({
  toast: () => 0,
  update: () => {},
});

// ── Main Component ──────────────────────────────────────────────────

interface DealDetailProps {
  dealId: bigint;
  onBack: () => void;
}

function CountdownTimer({ deadline }: { deadline: bigint }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remaining = Number(deadline) * 1000 - now;
  if (remaining <= 0) return <span className="text-red-400">Expired</span>;

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return <span className="text-amber-400 font-mono text-[11px]">{parts.join(' ')}</span>;
}

export function DealDetail({ dealId, onBack }: DealDetailProps) {
  const { address } = useAccount();
  const contractAddress = useBlindDealAddress();
  const chainId = useChainId();

  const { data: results, refetch } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDeadline', args: [dealId] },
    ],
    query: { refetchInterval: 8000 },
  });

  if (!results || results.some((r) => r.status === 'failure')) {
    return (
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-400 mb-4 inline-flex items-center gap-1 transition-colors">← Back</button>
        <div className="glass rounded-2xl p-8">
          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading deal...</span>
          </div>
        </div>
      </div>
    );
  }

  const state = results[0].result as number;
  const [buyer, seller] = results[1].result as [string, string];
  const description = results[2].result as string;
  const [buyerDone, sellerDone] = results[3].result as [boolean, boolean];
  const deadline = results[4].result as bigint;

  const isBuyer = address?.toLowerCase() === buyer.toLowerCase();
  const isSeller = address?.toLowerCase() === seller.toLowerCase();
  const isParticipant = isBuyer || isSeller;
  const role = isBuyer ? 'Buyer' : isSeller ? 'Seller' : 'Observer';

  const hasSubmitted = isBuyer ? buyerDone : sellerDone;
  const bothSubmitted = buyerDone && sellerDone;
  const isExpired = deadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > deadline;

  const steps = buildLifecycleSteps(state, buyerDone, sellerDone, bothSubmitted);

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-400 mb-4 inline-flex items-center gap-1 transition-colors">
        ← Back to Dashboard
      </button>

      <div className="glass rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-white">Deal #{dealId.toString()}</h2>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${DEAL_STATE_COLORS[state as DealState]}`}>
              {DEAL_STATE_LABELS[state as DealState]}
            </span>
          </div>
          <p className="text-slate-300">{description}</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <PartyCard label="Buyer" address={buyer} isYou={isBuyer} submitted={buyerDone} />
            <PartyCard label="Seller" address={seller} isYou={isSeller} submitted={sellerDone} />
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
            <span>Role: <span className="text-indigo-400 font-medium">{role}</span></span>
            <div className="flex items-center gap-3">
              <CopyDealLink dealId={dealId} chainId={chainId} />
              {deadline > 0n ? (
                state === DealState.Open && !isExpired ? (
                  <CountdownTimer deadline={deadline} />
                ) : (
                  <span className={isExpired ? 'text-red-400' : ''}>
                    {isExpired ? 'Expired' : `Due ${new Date(Number(deadline) * 1000).toLocaleDateString()}`}
                  </span>
                )
              ) : (
                <span>No deadline</span>
              )}
            </div>
          </div>
        </div>

        {/* Lifecycle Timeline */}
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <LifecycleTimeline steps={steps} />
        </div>

        {/* Actions */}
        <div className="p-5">
          {state === DealState.Open && isParticipant && !hasSubmitted && !isExpired && (
            <SubmitPriceSection dealId={dealId} isBuyer={isBuyer} onSuccess={refetch} />
          )}

          {state === DealState.Open && isParticipant && hasSubmitted && !bothSubmitted && (
            <WaitingMessage />
          )}

          {state === DealState.Open && bothSubmitted && (
            <FinalizeSection dealId={dealId} onSuccess={refetch} />
          )}

          {state === DealState.Open && isParticipant && !bothSubmitted && (
            <CancelSection dealId={dealId} onSuccess={refetch} />
          )}

          {state === DealState.Open && isExpired && (
            <ExpireSection dealId={dealId} onSuccess={refetch} />
          )}

          {state === DealState.Matched && (
            <MatchedSection dealId={dealId} isBuyer={isBuyer} isSeller={isSeller} buyer={buyer} seller={seller} />
          )}

          {state === DealState.NoMatch && <NoMatchMessage />}
          {state === DealState.Cancelled && <CancelledMessage />}
        </div>
      </div>
    </div>
  );
}

// ── Lifecycle Timeline ──────────────────────────────────────────────

interface Step { label: string; status: 'done' | 'active' | 'upcoming' }

function buildLifecycleSteps(state: number, buyerDone: boolean, sellerDone: boolean, bothSubmitted: boolean): Step[] {
  if (state === DealState.Cancelled) {
    return [
      { label: 'Created', status: 'done' },
      { label: 'Cancelled', status: 'done' },
    ];
  }
  if (state === DealState.NoMatch) {
    return [
      { label: 'Created', status: 'done' },
      { label: 'Prices Submitted', status: 'done' },
      { label: 'Compared', status: 'done' },
      { label: 'No Match', status: 'done' },
    ];
  }

  const steps: Step[] = [{ label: 'Created', status: 'done' }];

  if (!buyerDone && !sellerDone) {
    steps.push({ label: 'Submit Prices', status: 'active' }, { label: 'Finalize', status: 'upcoming' }, { label: 'Settlement', status: 'upcoming' });
  } else if (!bothSubmitted) {
    steps.push({ label: 'Prices Submitting', status: 'active' }, { label: 'Finalize', status: 'upcoming' }, { label: 'Settlement', status: 'upcoming' });
  } else if (state === DealState.Open && bothSubmitted) {
    steps.push({ label: 'Prices Submitted', status: 'done' }, { label: 'Finalize', status: 'active' }, { label: 'Settlement', status: 'upcoming' });
  } else if (state === DealState.Matched) {
    steps.push({ label: 'Prices Submitted', status: 'done' }, { label: 'Matched', status: 'done' }, { label: 'Settlement', status: 'active' });
  }

  return steps;
}

function LifecycleTimeline({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
          <div className={`flex items-center gap-1.5 min-w-0 ${
            step.status === 'done' ? 'text-emerald-400' : step.status === 'active' ? 'text-indigo-400' : 'text-slate-600'
          }`}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              step.status === 'done' ? 'bg-emerald-400' : step.status === 'active' ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'
            }`} />
            <span className="text-[11px] font-medium truncate">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px min-w-2 ${step.status === 'done' ? 'bg-emerald-500/30' : 'bg-white/[0.06]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Small Components ────────────────────────────────────────────────

function PartyCard({ label, address, isYou, submitted }: { label: string; address: string; isYou: boolean; submitted: boolean }) {
  return (
    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`w-2 h-2 rounded-full ${submitted ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      </div>
      <p className="text-sm font-mono text-slate-300">{address.slice(0, 6)}...{address.slice(-4)}</p>
      {isYou && <span className="text-[10px] text-indigo-400 font-medium">you</span>}
    </div>
  );
}

function CopyDealLink({ dealId, chainId }: { dealId: bigint; chainId: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const url = `${window.location.origin}?deal=${dealId}&chain=${chainId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const shareTelegram = () => {
    const url = `${window.location.origin}?deal=${dealId}&chain=${chainId}`;
    const text = encodeURIComponent(`Join my BlindDeal negotiation: ${url}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`, '_blank');
  };
  return (
    <div className="flex items-center gap-2">
      <button onClick={handleCopy} className="text-slate-500 hover:text-indigo-400 transition-colors">
        {copied ? <span className="text-emerald-400 text-[11px]">Copied!</span> : <span className="text-[11px]">Copy Link ↗</span>}
      </button>
      <button onClick={shareTelegram} className="text-slate-500 hover:text-sky-400 transition-colors" title="Share on Telegram">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      </button>
    </div>
  );
}

function WaitingMessage() {
  return (
    <div className="text-center py-4">
      <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-indigo-500/10 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
      </div>
      <p className="text-sm text-slate-400">Price submitted. Waiting for the other party...</p>
    </div>
  );
}

function NoMatchMessage() {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <p className="text-white font-medium">No Match</p>
      <p className="text-sm text-slate-400 mt-1">The buyer&#39;s max was below the seller&#39;s min. Neither price is revealed.</p>
    </div>
  );
}

function CancelledMessage() {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-500/10 flex items-center justify-center">
        <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <p className="text-white font-medium">Deal Cancelled</p>
    </div>
  );
}

// ── Submit Price Section ────────────────────────────────────────────

function SubmitPriceSection({ dealId, isBuyer, onSuccess }: { dealId: bigint; isBuyer: boolean; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { toast, update } = useContext(DealToastContext);
  const [price, setPrice] = useState('');
  const { encryptInputsAsync, isEncrypting } = useCofheEncrypt();
  const cofheConnection = useCofheConnection();
  const { address: userAddress } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!price) return;
    if (!cofheConnection.connected) {
      toast('error', 'FHE client not connected. Please wait for the zk-proof worker to load and try again.');
      return;
    }
    if (!userAddress) {
      toast('error', 'Wallet not connected. Please connect your wallet and try again.');
      return;
    }
    if (cofheConnection.account?.toLowerCase() !== userAddress.toLowerCase()) {
      console.error('[BlindDeal] Account mismatch:', {
        cofheAccount: cofheConnection.account,
        walletAddress: userAddress,
      });
      toast('error', 'Wallet account mismatch. Please disconnect and reconnect your wallet, then try again.');
      return;
    }

    const tid = toast('loading', 'Encrypting price with FHE...');
    try {
      console.log('[BlindDeal] Encrypting for:', {
        account: userAddress,
        chainId: cofheConnection.chainId,
        contract: contractAddress,
        dealId: dealId.toString(),
        price,
        isBuyer,
      });
      const encrypted = await encryptInputsAsync([Encryptable.uint64(BigInt(price))] as const);
      if (!encrypted || !encrypted[0]?.signature) {
        throw new Error('FHE encryption returned invalid data. Please refresh and try again.');
      }
      console.log('[BlindDeal] Encrypted result:', {
        ctHash: encrypted[0].ctHash.toString(16),
        securityZone: encrypted[0].securityZone,
        utype: encrypted[0].utype,
        signatureLength: encrypted[0].signature.length,
      });
      update(tid, 'loading', 'Submitting encrypted price...');

      const input = {
        ctHash: encrypted[0].ctHash,
        securityZone: encrypted[0].securityZone,
        utype: encrypted[0].utype,
        signature: encrypted[0].signature as `0x${string}`,
      };

      writeContract({
        address: contractAddress,
        abi: BLIND_DEAL_ABI,
        functionName: isBuyer ? 'submitBuyerPrice' : 'submitSellerPrice',
        args: [dealId, input],
      });
      update(tid, 'info', 'Confirm in your wallet...');
    } catch (err) {
      update(tid, 'error', err instanceof Error ? err.message : 'Encryption failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          {isBuyer ? 'Your Maximum Price' : 'Your Minimum Price'}
        </label>
        <div className="relative">
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Enter price"
            className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors pr-16"
            required
            min="1"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[10px] text-indigo-400 font-medium">FHE</span>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {isBuyer ? "Maximum you'll pay. Encrypted — seller never sees it." : "Minimum you'll accept. Encrypted — buyer never sees it."}
        </p>
      </div>

      {isEncrypting && (
        <div className="space-y-1.5">
          <div className="w-full bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-500 to-violet-500 h-1.5 rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-indigo-400">Encrypting with FHE...</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || isConfirming || isEncrypting}
        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-xl hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 hover:-translate-y-0.5 disabled:hover:translate-y-0"
      >
        {isEncrypting ? 'Encrypting...' : isPending ? 'Confirm in wallet...' : isConfirming ? 'Submitting...' : `Submit ${isBuyer ? 'Max' : 'Min'} Price (Encrypted)`}
      </button>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">{error.message.split('\n')[0]}</p>
        </div>
      )}
    </form>
  );
}

// ── Finalize Section ────────────────────────────────────────────────

function FinalizeSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { toast } = useContext(DealToastContext);
  const cofheClient = useCofheClient();
  const cofheConnection = useCofheConnection();
  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Read the encrypted match handle from contract
  const { data: matchHandle } = useReadContract({
    address: contractAddress,
    abi: BLIND_DEAL_ABI,
    functionName: 'getMatchResult',
    args: [dealId],
  });

  // Client-side CoFHE SDK decryption of the match result
  const [matchResult, setMatchResult] = useState<boolean | null>(null);
  const [decryptStatus, setDecryptStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [decryptError, setDecryptError] = useState<string | null>(null);

  useEffect(() => {
    const handle = matchHandle as bigint | undefined;
    if (!handle || handle === 0n || !cofheClient || !cofheConnection.connected || decryptStatus !== 'idle') return;

    let cancelled = false;
    setDecryptStatus('loading');

    cofheClient
      .decryptForView(handle, FheTypes.Bool)
      .execute()
      .then((val) => {
        if (!cancelled) { setMatchResult(!!val); setDecryptStatus('done'); }
      })
      .catch((err) => {
        if (!cancelled) {
          setDecryptError(err instanceof Error ? err.message : 'Failed to decrypt match result');
          setDecryptStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [matchHandle, cofheClient, cofheConnection.connected]);

  useEffect(() => {
    if (isSuccess) {
      toast('success', 'Deal finalized! FHE comparison complete.');
      onSuccess();
    }
  }, [isSuccess]);

  const handleFinalize = () => {
    if (matchResult == null) return;
    toast('loading', 'Finalizing deal...');
    writeContract({
      address: contractAddress,
      abi: BLIND_DEAL_ABI,
      functionName: 'clientFinalizeDeal',
      args: [dealId, matchResult],
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <p className="text-sm text-slate-400 mb-3">
          {decryptStatus === 'done'
            ? `CoFHE decryption complete — prices ${matchResult ? 'matched' : 'did not match'}. Ready to finalize.`
            : decryptStatus === 'error'
              ? 'Could not decrypt match result. Retrying...'
              : 'Both prices encrypted & submitted. Decrypting match result via CoFHE SDK...'}
        </p>
      </div>

      {decryptStatus !== 'done' ? (
        <div className="space-y-2">
          <div className="w-full py-3 bg-white/[0.04] border border-white/10 text-slate-400 font-medium rounded-xl text-center">
            <span className="inline-block w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
            {decryptStatus === 'error' ? 'Decryption failed' : 'Decrypting match result via CoFHE...'}
          </div>
          {decryptStatus === 'error' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-xs text-amber-400 mb-1">{decryptError}</p>
              <button onClick={() => setDecryptStatus('idle')} className="text-xs text-indigo-400 hover:text-indigo-300">Retry →</button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleFinalize}
          disabled={isPending || isConfirming}
          className="w-full py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium rounded-xl hover:from-emerald-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20"
        >
          {isPending ? 'Confirm in wallet...' : isConfirming ? 'Finalizing...' : 'Finalize Deal'}
        </button>
      )}

      {writeError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">
            {writeError.message.split('\n')[0]}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Cancel Section ──────────────────────────────────────────────────

function CancelSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess]);

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <button
        onClick={() => writeContract({ address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'cancelDeal', args: [dealId] })}
        disabled={isPending || isConfirming}
        className="w-full py-2.5 text-sm text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/10 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Confirm...' : isConfirming ? 'Cancelling...' : 'Cancel Deal'}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error.message.split('\n')[0]}</p>}
    </div>
  );
}

// ── Expire Section ──────────────────────────────────────────────────

function ExpireSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess]);

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <button
        onClick={() => writeContract({ address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'expireDeal', args: [dealId] })}
        disabled={isPending || isConfirming}
        className="w-full py-2.5 text-sm text-amber-400 border border-amber-500/20 rounded-xl hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Confirm...' : isConfirming ? 'Expiring...' : 'Expire Deal (Past Deadline)'}
      </button>
    </div>
  );
}

// ── Matched Section — Full settlement flow ──────────────────────────

function MatchedSection({
  dealId,
  isBuyer,
  isSeller,
  buyer,
  seller,
}: {
  dealId: bigint;
  isBuyer: boolean;
  isSeller: boolean;
  buyer: string;
  seller: string;
}) {
  const contractAddress = useBlindDealAddress();
  const resolverAddress = useResolverAddress();
  const chainId = useChainId();
  const cofheClient = useCofheClient();
  const cofheConnection = useCofheConnection();
  const { toast, update } = useContext(DealToastContext);

  // Read deal price handle
  const { data: priceResult } = useReadContract({
    address: contractAddress,
    abi: BLIND_DEAL_ABI,
    functionName: 'getDealPrice',
    args: [dealId],
  });

  const priceHandle = priceResult as bigint | undefined;

  // Unseal the deal price
  const [unsealedPrice, setUnsealedPrice] = useState<bigint | null>(null);
  const [unsealStatus, setUnsealStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [unsealError, setUnsealError] = useState<string | null>(null);

  useEffect(() => {
    if (!priceHandle || priceHandle === 0n || !cofheClient || !cofheConnection.connected || unsealStatus !== 'idle') return;

    let cancelled = false;
    setUnsealStatus('loading');

    cofheClient
      .decryptForView(priceHandle, FheTypes.Uint64)
      .execute()
      .then((val) => {
        if (!cancelled) { setUnsealedPrice(val); setUnsealStatus('done'); }
      })
      .catch((err) => {
        if (!cancelled) { setUnsealError(err instanceof Error ? err.message : 'Failed to unseal'); setUnsealStatus('error'); }
      });

    return () => { cancelled = true; };
  }, [priceHandle, cofheClient, cofheConnection.connected]);

  // ── Escrow state (direct contract calls, bypassing cofhejs@0.3.1) ──
  const escrowAddress = useEscrowAddress();
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const [escrowId, setEscrowId] = useState<bigint | null>(() => getStoredEscrowId(dealId, chainId));
  const [escrowStatus, setEscrowStatus] = useState<'none' | 'created' | 'linking' | 'linked' | 'funded' | 'redeemed'>('none');
  const [isProcessing, setIsProcessing] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [fundMode, setFundMode] = useState<'local' | 'cross-chain'>('local');
  const [cctpProgress, setCctpProgress] = useState<string | null>(null);
  const [cctpMessageBytes, setCctpMessageBytes] = useState<`0x${string}` | null>(null);
  const [cctpAttestation, setCctpAttestation] = useState<string | null>(null);

  // Check if escrow is linked to resolver
  const { data: isRegistered } = useReadContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: 'registered',
    args: escrowId != null ? [escrowId] : undefined,
    query: { enabled: escrowId != null && !!resolverAddress },
  });

  // Check if condition is met
  const { data: conditionMet } = useReadContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: 'isConditionMet',
    args: escrowId != null ? [escrowId] : undefined,
    query: { enabled: escrowId != null && !!resolverAddress && isRegistered === true, refetchInterval: 10000 },
  });

  // Poll escrow funding status via EscrowFunded events (every 10s)
  useEffect(() => {
    if (!publicClient || escrowId == null || !escrowAddress) return;
    let cancelled = false;

    const check = async () => {
      try {
        const events = await publicClient.getContractEvents({
          address: escrowAddress,
          abi: ESCROW_ABI,
          eventName: 'EscrowFunded',
          args: { escrowId },
          fromBlock: 0n,
        });
        if (cancelled) return;
        if (events.length > 0) {
          setEscrowStatus('funded');
        } else if (isRegistered === true) {
          setEscrowStatus('linked');
        } else if (isRegistered === false) {
          setEscrowStatus('created');
        }
        // If isRegistered is undefined, don't change status (still loading)
      } catch {
        // On error, don't downgrade status
      }
    };

    check();
    const interval = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [publicClient, escrowId, escrowAddress, isRegistered]);

  // Link escrow to resolver tx
  const { writeContract: writeLinkEscrow, data: linkTxHash } = useWriteContract();
  const { isSuccess: linkSuccess } = useWaitForTransactionReceipt({ hash: linkTxHash });

  useEffect(() => {
    if (linkSuccess) {
      setEscrowStatus('linked');
      toast('success', 'Escrow linked to condition resolver');
    }
  }, [linkSuccess]);

  // Redeem escrow TX
  const { writeContract: writeRedeemEscrow, data: redeemTxHash } = useWriteContract();
  const { isSuccess: redeemSuccess } = useWaitForTransactionReceipt({ hash: redeemTxHash });

  useEffect(() => {
    if (redeemSuccess) {
      setEscrowStatus('redeemed');
      setIsProcessing(false);
      toast('success', 'Escrow redeemed! Settlement complete.');
    }
  }, [redeemSuccess]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleCreateEscrow = async () => {
    if (unsealedPrice == null || !seller || !resolverAddress || !escrowAddress) return;
    setIsProcessing(true);
    setEscrowError(null);
    const tid = toast('loading', 'Creating escrow via Privara...');

    try {
      const response = await fetch('/api/escrow/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(unsealedPrice),
          owner: seller,
          resolver: resolverAddress,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      if (data.escrow_id != null) {
        const newEscrowId = BigInt(data.escrow_id);
        storeEscrowId(dealId, chainId, newEscrowId);
        setEscrowId(newEscrowId);
        setEscrowStatus('created');
        setIsProcessing(false);
        update(tid, 'success', `Escrow #${newEscrowId} created`);
      } else {
        update(tid, 'info', `Escrow created (tx: ${data.tx_hash?.slice(0, 14)}...) — check Arbiscan for ID`);
        setIsProcessing(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create escrow';
      setEscrowError(msg);
      update(tid, 'error', msg);
      setIsProcessing(false);
    }
  };

  const handleLinkEscrow = () => {
    if (escrowId == null || !resolverAddress) return;
    setIsProcessing(true);
    setEscrowStatus('linking');
    toast('loading', 'Linking escrow to deal condition...');
    writeLinkEscrow({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: 'linkEscrow',
      args: [escrowId, dealId],
    });
  };

  const handleFundEscrow = async () => {
    if (escrowId == null || unsealedPrice == null || !escrowAddress) return;
    setIsProcessing(true);
    setEscrowError(null);

    if (fundMode === 'cross-chain') {
      const tid = toast('loading', 'Starting CCTP cross-chain bridge...');
      try {
        const ethereum = (window as any).ethereum;
        if (!ethereum) throw new Error('No wallet detected');

        // Switch to Ethereum Sepolia
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }], // 11155111
        });

        const ethWalletClient = createWalletClient({
          account: userAddress!,
          chain: sepolia,
          transport: custom(ethereum),
        });

        const arbPublicClient = publicClient; // Current public client should be on Arb Sepolia
        if (!arbPublicClient) throw new Error('Arbitrum public client not available');

        setCctpProgress('Approving USDC on Ethereum Sepolia...');
        const { messageBytes, attestation } = await bridgeUSDCViaCCTP({
          amount: BigInt(unsealedPrice) * 10n ** 6n, // USDC 6 decimals
          recipient: userAddress!,
          ethWalletClient,
          arbPublicClient,
          onProgress: (p) => setCctpProgress(p.message ?? null),
        });

        setCctpMessageBytes(messageBytes);
        setCctpAttestation(attestation);
        setCctpProgress('USDC bridged! Switch to Arbitrum Sepolia and click "Complete Mint".');
        update(tid, 'success', 'CCTP burn complete. Complete mint on Arbitrum.');
        setIsProcessing(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'CCTP bridge failed';
        setEscrowError(msg);
        setCctpProgress(null);
        update(tid, 'error', msg);
        setIsProcessing(false);
      }
      return;
    }

    const tid = toast('loading', 'Funding escrow via Privara...');
    try {
      const response = await fetch('/api/escrow/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrowId: escrowId.toString(),
          amount: Number(unsealedPrice),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Fund request failed');
      }

      setEscrowStatus('funded');
      setIsProcessing(false);
      update(tid, 'success', `Escrow funded (tx: ${data.tx_hash?.slice(0, 14)}...)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fund escrow';
      setEscrowError(msg);
      update(tid, 'error', msg);
      setIsProcessing(false);
    }
  };

  const handleCompleteCCTPMint = async () => {
    if (!cctpMessageBytes || !cctpAttestation) return;
    setIsProcessing(true);
    const tid = toast('loading', 'Minting USDC on Arbitrum Sepolia...');
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error('No wallet detected');

      // Ensure on Arbitrum Sepolia
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x66eee' }], // 421614
      });

      const arbWalletClient = createWalletClient({
        account: userAddress!,
        chain: arbitrumSepolia,
        transport: custom(ethereum),
      });

      await receiveCCTPMessageOnArbitrum({
        messageBytes: cctpMessageBytes,
        attestation: cctpAttestation,
        arbWalletClient,
      });

      setCctpProgress('Mint complete! Now fund escrow locally with minted USDC.');
      setCctpMessageBytes(null);
      setCctpAttestation(null);
      update(tid, 'success', 'CCTP mint complete on Arbitrum');
      setIsProcessing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'CCTP mint failed';
      setEscrowError(msg);
      update(tid, 'error', msg);
      setIsProcessing(false);
    }
  };

  const handleRedeemEscrow = async () => {
    if (escrowId == null || !escrowAddress) return;
    if (conditionMet !== true) {
      setEscrowError('Deal condition not yet verified on-chain. Please wait.');
      return;
    }
    setIsProcessing(true);
    setEscrowError(null);
    toast('loading', 'Confirm redemption in wallet...');

    writeRedeemEscrow({
      address: escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'redeem',
      args: [escrowId],
    });
  };

  // Settlement progress steps
  const settlementSteps: Step[] = [
    { label: 'Create', status: escrowId != null ? 'done' : 'active' },
    { label: 'Link', status: escrowStatus === 'linked' || escrowStatus === 'funded' || escrowStatus === 'redeemed' ? 'done' : escrowId != null && (escrowStatus === 'created' || escrowStatus === 'linking') ? 'active' : 'upcoming' },
    { label: 'Fund', status: escrowStatus === 'funded' || escrowStatus === 'redeemed' ? 'done' : escrowStatus === 'linked' ? 'active' : 'upcoming' },
    { label: 'Redeem', status: escrowStatus === 'redeemed' ? 'done' : escrowStatus === 'funded' ? 'active' : 'upcoming' },
  ];

  return (
    <div className="space-y-4">
      {/* Match confirmation */}
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center animate-pulse-glow">
          <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-white font-medium">Deal Matched!</p>
        <p className="text-sm text-slate-400 mt-1">Buyer&#39;s max ≥ Seller&#39;s min</p>
      </div>

      {/* Unsealed price */}
      {unsealedPrice != null ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-xs text-emerald-400 font-medium uppercase tracking-wide">Agreed Price</p>
          <p className="text-3xl font-bold text-emerald-300 mt-1">{unsealedPrice.toString()} <span className="text-lg text-emerald-400/60">USDC</span></p>
          <p className="text-xs text-slate-500 mt-1">Midpoint of buyer max &amp; seller min</p>
        </div>
      ) : unsealStatus === 'loading' ? (
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Unsealing price with FHE permit...</p>
          </div>
        </div>
      ) : unsealStatus === 'error' ? (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <p className="text-xs text-amber-400 font-medium mb-1">Could not unseal price</p>
          <p className="text-xs text-slate-500">{unsealError}</p>
          <button onClick={() => setUnsealStatus('idle')} className="text-xs text-indigo-400 hover:text-indigo-300 mt-1">Retry →</button>
        </div>
      ) : (
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4 text-center">
          <p className="text-sm text-slate-500">Loading price...</p>
        </div>
      )}

      {/* Settlement Section */}
      {(isBuyer || isSeller) && unsealedPrice != null && (
        <div className="pt-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-white">Escrow Settlement</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20">Privara</span>
            {conditionMet && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">Condition Met</span>
            )}
          </div>

          {/* Settlement timeline */}
          <div className="mb-4">
            <LifecycleTimeline steps={settlementSteps} />
          </div>

          {/* Step 1: Create escrow (buyer) */}
          {escrowId == null && isBuyer && (
            <>
              <button
                onClick={handleCreateEscrow}
                disabled={isProcessing || !escrowAddress || !cofheConnection.connected}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-xl hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20"
              >
                {!cofheConnection.connected ? 'Connecting FHE...' : isProcessing ? 'Creating...' : `Create Escrow — ${unsealedPrice} USDC`}
              </button>
            </>
          )}

          {/* Step 2: Link to condition resolver (buyer) */}
          {escrowId != null && escrowStatus === 'created' && isBuyer && resolverAddress && (
            <button
              onClick={handleLinkEscrow}
              disabled={isProcessing}
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white font-medium rounded-xl hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-600/20"
            >
              {isProcessing ? 'Linking...' : `Link to Deal #${dealId} Condition`}
            </button>
          )}

          {/* Step 3: Fund escrow (buyer) */}
          {escrowId != null && escrowStatus === 'linked' && isBuyer && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setFundMode('local')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                    fundMode === 'local'
                      ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300 ring-1 ring-indigo-500/20'
                      : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="block text-sm mb-0.5">Fund Locally</span>
                  <span className="text-[10px] text-slate-500">Same chain USDC</span>
                </button>
                <button
                  onClick={() => setFundMode('cross-chain')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                    fundMode === 'cross-chain'
                      ? 'bg-violet-500/20 border-violet-500/30 text-violet-300 ring-1 ring-violet-500/20'
                      : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="block text-sm mb-0.5">CCTP Bridge</span>
                  <span className="text-[10px] text-slate-500">From Eth Sepolia</span>
                </button>
              </div>

              {fundMode === 'cross-chain' && (
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-violet-300 mb-1">
                    <span className="font-medium">Cross-chain via CCTP</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Burns USDC on Ethereum Sepolia → mints on Arbitrum Sepolia → auto-funds escrow.
                    Takes ~5-15 min.
                  </p>
                </div>
              )}

              {cctpProgress && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin flex-shrink-0" />
                    <p className="text-xs text-amber-300">{cctpProgress}</p>
                  </div>
                </div>
              )}

              <button
                onClick={handleFundEscrow}
                disabled={isProcessing}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium rounded-xl hover:from-emerald-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20"
              >
                {isProcessing ? 'Processing...' : `Fund ${unsealedPrice} USDC${fundMode === 'cross-chain' ? ' (CCTP)' : ''}`}
              </button>

              {cctpMessageBytes && cctpAttestation && (
                <button
                  onClick={handleCompleteCCTPMint}
                  disabled={isProcessing}
                  className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium rounded-xl hover:from-violet-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-600/20"
                >
                  {isProcessing ? 'Minting...' : 'Complete Mint on Arbitrum'}
                </button>
              )}
            </div>
          )}

          {/* Step 4: Redeem (seller) */}
          {escrowId != null && escrowStatus === 'funded' && isSeller && (
            <div className="space-y-2">
              {conditionMet === true ? (
                <>
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-xs text-emerald-400">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Condition resolver confirms deal is Matched — ready to redeem.</span>
                    </div>
                  </div>
                  <button
                    onClick={handleRedeemEscrow}
                    disabled={isProcessing}
                    className="w-full py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium rounded-xl hover:from-emerald-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20"
                  >
                    {isProcessing ? 'Redeeming...' : `Redeem ${unsealedPrice} USDC`}
                  </button>
                </>
              ) : (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin flex-shrink-0" />
                    <span>Waiting for deal condition to be verified on-chain...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Waiting messages */}
          {escrowId == null && isSeller && (
            <p className="text-xs text-slate-500 text-center py-3">Waiting for buyer to create escrow...</p>
          )}
          {escrowId != null && escrowStatus !== 'funded' && escrowStatus !== 'redeemed' && isSeller && (
            <p className="text-xs text-slate-500 text-center py-3">Escrow created. Waiting for buyer to link &amp; fund...</p>
          )}
          {escrowId != null && escrowStatus === 'funded' && isSeller && conditionMet !== true && (
            <p className="text-xs text-slate-500 text-center py-3">Escrow funded. Waiting for deal condition to be verified...</p>
          )}
          {escrowId != null && escrowStatus === 'funded' && isBuyer && (
            <p className="text-xs text-emerald-400 text-center py-3">Escrow funded! Waiting for seller to redeem.</p>
          )}

          {/* Redeemed */}
          {escrowStatus === 'redeemed' && (
            <div className="text-center py-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <svg className="w-8 h-8 mx-auto text-emerald-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-emerald-400 font-medium">Settlement Complete</p>
              <p className="text-xs text-slate-500 mt-1">{unsealedPrice.toString()} USDC settled via Privara Escrow #{escrowId?.toString()}</p>
            </div>
          )}

          {/* Escrow info bar */}
          {escrowId != null && escrowStatus !== 'redeemed' && (
            <div className="mt-3 bg-white/[0.04] border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Escrow #{escrowId.toString()}</span>
                  {isRegistered && (
                    <span className="text-emerald-400/60">🔗 Deal #{dealId.toString()}</span>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded-full ${
                  escrowStatus === 'funded' ? 'bg-emerald-500/10 text-emerald-400'
                    : escrowStatus === 'linked' ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {escrowStatus}
                </span>
              </div>
            </div>
          )}

          {/* Errors */}
          {escrowError && (
            <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-xs text-red-400">{escrowError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

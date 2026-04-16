import { useState } from 'react';
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useCofheEncrypt } from '@cofhe/react';
import { Encryptable } from '@cofhe/sdk';
import {
  BLIND_DEAL_ABI,
  useBlindDealAddress,
  DealState,
  DEAL_STATE_LABELS,
  DEAL_STATE_COLORS,
} from '../config/contract';

interface DealDetailProps {
  dealId: bigint;
  onBack: () => void;
}

export function DealDetail({ dealId, onBack }: DealDetailProps) {
  const { address } = useAccount();
  const contractAddress = useBlindDealAddress();

  const { data: results, refetch } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] },
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealDeadline', args: [dealId] },
    ],
  });

  if (!results || results.some((r) => r.status === 'failure')) {
    return <div className="text-center py-12 text-slate-500">Loading deal...</div>;
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
            {deadline > 0n ? (
              <span className={isExpired ? 'text-red-400' : ''}>
                {isExpired ? 'Expired' : `Due ${new Date(Number(deadline) * 1000).toLocaleDateString()}`}
              </span>
            ) : (
              <span>No deadline</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-5">
          {state === DealState.Open && isParticipant && !hasSubmitted && !isExpired && (
            <SubmitPriceSection
              dealId={dealId}
              isBuyer={isBuyer}
              onSuccess={refetch}
            />
          )}

          {state === DealState.Open && isParticipant && hasSubmitted && !bothSubmitted && (
            <div className="text-center py-4">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-indigo-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-sm text-slate-400">
                Price submitted. Waiting for the other party...
              </p>
            </div>
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
            <MatchedSection dealId={dealId} />
          )}

          {state === DealState.NoMatch && (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-white font-medium">No Match</p>
              <p className="text-sm text-slate-400 mt-1">
                The buyer&#39;s max was below the seller&#39;s min. Neither price is revealed.
              </p>
            </div>
          )}

          {state === DealState.Cancelled && (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <p className="text-white font-medium">Deal Cancelled</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* Party Card                                          */
/* -------------------------------------------------- */

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

/* -------------------------------------------------- */
/* Submit Price Section                                */
/* -------------------------------------------------- */

function SubmitPriceSection({
  dealId,
  isBuyer,
  onSuccess,
}: {
  dealId: bigint;
  isBuyer: boolean;
  onSuccess: () => void;
}) {
  const contractAddress = useBlindDealAddress();
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState('');
  const { encryptInputsAsync, isEncrypting } = useCofheEncrypt();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess) {
    onSuccess();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!price) return;

    try {
      setStatus('Encrypting your price with FHE...');

      const encrypted = await encryptInputsAsync(
        [Encryptable.uint64(BigInt(price))] as const,
      );

      setStatus('Submitting encrypted price...');

      const encryptedInput = {
        ctHash: encrypted[0].ctHash,
        securityZone: encrypted[0].securityZone,
        utype: encrypted[0].utype,
        signature: encrypted[0].signature as `0x${string}`,
      };

      if (isBuyer) {
        writeContract({
          address: contractAddress,
          abi: BLIND_DEAL_ABI,
          functionName: 'submitBuyerPrice',
          args: [dealId, encryptedInput],
        });
      } else {
        writeContract({
          address: contractAddress,
          abi: BLIND_DEAL_ABI,
          functionName: 'submitSellerPrice',
          args: [dealId, encryptedInput],
        });
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          {isBuyer ? 'Your Maximum Price' : 'Your Minimum Price'}
        </label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Enter your price"
          className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors"
          required
          min="1"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          {isBuyer
            ? 'The maximum price you are willing to pay. Encrypted with FHE.'
            : 'The minimum price you will accept. Encrypted with FHE.'}
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

      {status && !isEncrypting && (
        <p className="text-xs text-slate-500">{status}</p>
      )}

      <button
        type="submit"
        disabled={isPending || isConfirming || isEncrypting}
        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-xl hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 hover:-translate-y-0.5 disabled:hover:translate-y-0"
      >
        {isEncrypting
          ? 'Encrypting...'
          : isPending
            ? 'Confirm in wallet...'
            : isConfirming
              ? 'Submitting...'
              : `Submit ${isBuyer ? 'Max' : 'Min'} Price (Encrypted)`}
      </button>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">{error.message.split('\n')[0]}</p>
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------- */
/* Finalize Section                                    */
/* -------------------------------------------------- */

function FinalizeSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess) {
    onSuccess();
  }

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-sm text-slate-400 mb-3">
          Both prices submitted! FHE comparison processing. Click to finalize.
        </p>
      </div>

      <button
        onClick={() =>
          writeContract({
            address: contractAddress,
            abi: BLIND_DEAL_ABI,
            functionName: 'finalizeDeal',
            args: [dealId],
          })
        }
        disabled={isPending || isConfirming}
        className="w-full py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-medium rounded-xl hover:from-emerald-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20"
      >
        {isPending ? 'Confirm in wallet...' : isConfirming ? 'Finalizing...' : 'Finalize Deal'}
      </button>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">
            {error.message.includes('not ready')
              ? 'Decryption not ready yet. Please try again in a few seconds.'
              : error.message.split('\n')[0]}
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------- */
/* Cancel Section                                      */
/* -------------------------------------------------- */

function CancelSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess) {
    onSuccess();
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <button
        onClick={() =>
          writeContract({
            address: contractAddress,
            abi: BLIND_DEAL_ABI,
            functionName: 'cancelDeal',
            args: [dealId],
          })
        }
        disabled={isPending || isConfirming}
        className="w-full py-2.5 text-sm text-red-400 border border-red-500/20 rounded-xl hover:bg-red-500/10 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Confirm...' : isConfirming ? 'Cancelling...' : 'Cancel Deal'}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-400">{error.message.split('\n')[0]}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------- */
/* Expire Section                                      */
/* -------------------------------------------------- */

function ExpireSection({ dealId, onSuccess }: { dealId: bigint; onSuccess: () => void }) {
  const contractAddress = useBlindDealAddress();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess) {
    onSuccess();
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <button
        onClick={() =>
          writeContract({
            address: contractAddress,
            abi: BLIND_DEAL_ABI,
            functionName: 'expireDeal',
            args: [dealId],
          })
        }
        disabled={isPending || isConfirming}
        className="w-full py-2.5 text-sm text-amber-400 border border-amber-500/20 rounded-xl hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
      >
        {isPending ? 'Confirm...' : isConfirming ? 'Expiring...' : 'Expire Deal (Past Deadline)'}
      </button>
    </div>
  );
}

/* -------------------------------------------------- */
/* Matched Section — Reveal the agreed price           */
/* -------------------------------------------------- */

function MatchedSection({ dealId }: { dealId: bigint }) {
  const contractAddress = useBlindDealAddress();
  const { data: priceHandle } = useReadContracts({
    contracts: [
      { address: contractAddress, abi: BLIND_DEAL_ABI, functionName: 'getDealPrice', args: [dealId] },
    ],
  });

  const price = priceHandle?.[0]?.result as bigint | undefined;

  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center animate-pulse-glow">
        <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-white font-medium">Deal Matched!</p>
      <p className="text-sm text-slate-400 mb-4 mt-1">
        The buyer&#39;s max was ≥ the seller&#39;s min.
      </p>
      {price !== undefined && price > 0n ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-xs text-emerald-400 font-medium uppercase tracking-wide">Agreed Price (Encrypted Handle)</p>
          <p className="text-lg font-bold text-emerald-300 font-mono break-all mt-1">
            {price.toString()}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Use the CoFHE SDK to unseal and view the actual price.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading price handle...</p>
      )}
    </div>
  );
}

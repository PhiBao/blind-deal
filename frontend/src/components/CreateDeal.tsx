import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { BLIND_DEAL_ABI, useBlindDealAddress } from '../config/contract';

interface CreateDealProps {
  onCreated: (dealId: bigint) => void;
}

export function CreateDeal({ onCreated }: CreateDealProps) {
  const { isConnected } = useAccount();
  const contractAddress = useBlindDealAddress();
  const [seller, setSeller] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('3600'); // 1 hour default

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!seller || !description) return;

    writeContract({
      address: contractAddress,
      abi: BLIND_DEAL_ABI,
      functionName: 'createDeal',
      args: [seller as `0x${string}`, description, BigInt(duration)],
    });
  };

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">Connect your wallet to create a deal.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-semibold text-white mb-6">Create New Deal</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Seller Address
          </label>
          <input
            type="text"
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            placeholder="0x..."
            className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors"
            required
          />
          <p className="mt-1.5 text-xs text-slate-500">The counterparty you want to negotiate with</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Purchase of 1 ETH worth of NFTs"
            className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Duration
          </label>
          <div className="flex gap-2">
            {[
              { label: '1h', value: '3600' },
              { label: '24h', value: '86400' },
              { label: '7d', value: '604800' },
              { label: 'No limit', value: '0' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDuration(opt.value)}
                className={`px-3.5 py-1.5 text-sm rounded-lg border transition-all ${
                  duration === opt.value
                    ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300 ring-1 ring-indigo-500/20'
                    : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04] hover:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-2 w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-colors text-sm"
            min="0"
          />
        </div>

        <button
          type="submit"
          disabled={isPending || isConfirming}
          className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-xl hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 hover:-translate-y-0.5 disabled:hover:translate-y-0"
        >
          {isPending ? 'Confirm in wallet...' : isConfirming ? 'Creating deal...' : 'Create Deal'}
        </button>

        {error && (
          <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-400">{error.message.split('\n')[0]}</p>
          </div>
        )}

        {isSuccess && txHash && (
          <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <p className="text-sm text-emerald-400 mb-2">Deal created successfully!</p>
            <button
              type="button"
              onClick={() => {
                // Parse dealId from events — for now navigate back to dashboard
                onCreated(0n);
              }}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Go to Dashboard →
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

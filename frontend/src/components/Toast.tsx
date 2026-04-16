import { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    if (type !== 'loading') {
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const update = useCallback((id: number, type: ToastType, message: string, duration = 5000) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, type, message } : t)));
    const oldTimer = timers.current.get(id);
    if (oldTimer) clearTimeout(oldTimer);
    if (type !== 'loading') {
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    }
  }, [dismiss]);

  return { toasts, toast, update, dismiss };
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  loading: '⟳',
};

const COLORS: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  info: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  loading: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
};

const ICON_BG: Record<ToastType, string> = {
  success: 'bg-emerald-500/20 text-emerald-400',
  error: 'bg-red-500/20 text-red-400',
  info: 'bg-indigo-500/20 text-indigo-400',
  loading: 'bg-amber-500/20 text-amber-400',
};

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl animate-slide-up ${COLORS[t.type]}`}
        >
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${ICON_BG[t.type]} ${t.type === 'loading' ? 'animate-spin' : ''}`}>
            {ICONS[t.type]}
          </span>
          <p className="text-sm flex-1">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-slate-500 hover:text-white transition-colors text-xs ml-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

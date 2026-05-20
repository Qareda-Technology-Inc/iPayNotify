import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const MessageContext = createContext(null);

let idSeq = 0;

const variantStyles = {
  success: 'border-emerald-500/45 bg-emerald-950/95 text-emerald-50 shadow-emerald-950/40',
  error: 'border-red-500/45 bg-red-950/95 text-red-50 shadow-red-950/40',
  info: 'border-slate-600 bg-slate-900/95 text-slate-100 shadow-black/30',
  warning: 'border-amber-500/45 bg-amber-950/95 text-amber-50 shadow-amber-950/40',
};

function ToastItem({ message, variant, onDismiss }) {
  const bar =
    variant === 'success'
      ? 'bg-emerald-400'
      : variant === 'error'
        ? 'bg-red-400'
        : variant === 'warning'
          ? 'bg-amber-400'
          : 'bg-slate-400';

  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-[min(100vw-2rem,22rem)] items-stretch gap-0 overflow-hidden rounded-lg border shadow-lg ${variantStyles[variant] || variantStyles.info}`}
    >
      <div className={`w-1 shrink-0 ${bar}`} aria-hidden />
      <div className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pl-2.5 pr-1">
        <p className="min-w-0 flex-1 text-sm leading-snug">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-current opacity-70 hover:bg-white/10 hover:opacity-100"
          aria-label="Dismiss notification"
        >
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Wraps the admin dashboard so any nested route can call {@link useMessage}.
 */
export function MessageProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    },
    []
  );

  const showMessage = useCallback(
    (message, options = {}) => {
      const variant = options.variant ?? 'info';
      const durationMs = options.durationMs ?? 4500;
      const text = String(message || '').trim() || 'Done.';
      const id = ++idSeq;
      setToasts((prev) => [...prev, { id, message: text, variant }]);
      if (durationMs > 0) {
        const t = setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      showMessage,
      showSuccess: (msg, opts) => showMessage(msg, { ...opts, variant: 'success' }),
      showError: (msg, opts) => showMessage(msg, { ...opts, variant: 'error' }),
      showInfo: (msg, opts) => showMessage(msg, { ...opts, variant: 'info' }),
      showWarning: (msg, opts) => showMessage(msg, { ...opts, variant: 'warning' }),
      dismiss,
    }),
    [showMessage, dismiss]
  );

  return (
    <MessageContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} message={t.message} variant={t.variant} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </MessageContext.Provider>
  );
}

export function useMessage() {
  const ctx = useContext(MessageContext);
  if (!ctx) {
    throw new Error('useMessage must be used within MessageProvider');
  }
  return ctx;
}

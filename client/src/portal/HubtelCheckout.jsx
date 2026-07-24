import { useEffect, useRef, useState } from 'react';
import CheckoutSdk from '@hubteljs/checkout';

function parsePaymentData(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { raw };
  }
}

/**
 * Opens Hubtel Online Checkout via the official `@hubteljs/checkout` SDK (modal, iframe fallback).
 * @see https://developers.hubtel.com — External Checkout SDK
 */
export function HubtelCheckout({ open, purchaseInfo, hubtelConfig, onSuccess, onFailure, onClose }) {
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [useIframe, setUseIframe] = useState(false);
  const started = useRef(false);
  const checkoutRef = useRef(null);
  const onSuccessRef = useRef(onSuccess);
  const onFailureRef = useRef(onFailure);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onFailureRef.current = onFailure;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      started.current = false;
      setErr('');
      setLoading(false);
      setUseIframe(false);
      return undefined;
    }
    if (!purchaseInfo || !hubtelConfig) {
      setErr('Missing Hubtel checkout session');
      return undefined;
    }
    if (started.current) return undefined;
    started.current = true;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr('');
      try {
        const checkout = new CheckoutSdk();
        if (cancelled) return;
        checkoutRef.current = checkout;

        const callBacks = {
          onInit: () => {
            if (!cancelled) setLoading(false);
          },
          onLoad: () => {
            if (!cancelled) setLoading(false);
          },
          onPaymentSuccess: (response) => {
            const data = parsePaymentData(response?.data ?? response);
            try {
              checkout.closePopUp?.();
            } catch {
              /* ignore */
            }
            onSuccessRef.current?.(data);
          },
          onPaymentFailure: (response) => {
            const data = parsePaymentData(response?.data ?? response);
            onFailureRef.current?.(data);
          },
          onClose: () => {
            onCloseRef.current?.();
          },
        };

        if (typeof checkout.openModal === 'function') {
          checkout.openModal({
            purchaseInfo,
            config: hubtelConfig,
            callBacks,
          });
          if (!cancelled) setLoading(false);
        } else if (typeof checkout.initIframe === 'function') {
          setUseIframe(true);
          // Wait a tick so the iframe container is in the DOM.
          await new Promise((r) => requestAnimationFrame(() => r()));
          if (cancelled) return;
          checkout.initIframe({
            purchaseInfo,
            config: hubtelConfig,
            iframeStyle: { width: '100%', height: '100%', border: 'none' },
            callBacks,
          });
        } else {
          throw new Error('Hubtel SDK missing openModal/initIframe');
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Could not open Hubtel checkout');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, purchaseInfo, hubtelConfig]);

  if (!open) return null;

  // Modal path: Hubtel draws its own popup; we only show status/errors + a Close control.
  if (!useIframe) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:p-4">
        {(loading || err) && (
          <div className="pointer-events-auto w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
            {loading && <p className="text-sm text-slate-300">Opening Hubtel checkout…</p>}
            {err && <p className="text-sm text-red-200">{err}</p>}
            {err && (
              <button
                type="button"
                className="mt-2 rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                onClick={() => onClose?.()}
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/90 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p className="text-sm font-medium text-white">Pay with Hubtel</p>
          <button
            type="button"
            className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            onClick={() => {
              try {
                checkoutRef.current?.closePopUp?.();
              } catch {
                /* ignore */
              }
              onClose?.();
            }}
          >
            Close
          </button>
        </div>
        <div className="relative min-h-[420px] flex-1 bg-slate-950">
          <div id="hubtel-checkout-iframe" className="absolute inset-0 h-full w-full" />
          {loading && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
              Loading checkout…
            </p>
          )}
          {err && (
            <p className="absolute inset-x-4 top-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

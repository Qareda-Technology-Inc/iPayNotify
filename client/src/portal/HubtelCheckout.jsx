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

function dismissCheckout(checkout) {
  if (!checkout) return;
  try {
    checkout.closePopUp?.();
  } catch {
    /* ignore */
  }
  try {
    checkout.destroy?.();
  } catch {
    /* ignore */
  }
  /* Belt-and-suspenders: SDK sometimes leaves backdrop/modal in the DOM */
  try {
    document.querySelectorAll('.backdrop, .checkout-modal').forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  } catch {
    /* ignore */
  }
}

function isHubtelCancelOrCloseMessage(data) {
  if (!data || typeof data !== 'object') return false;
  const type = String(data.type || data.event || data.action || '').toLowerCase();
  const status = String(data.status || data.Status || '').toLowerCase();
  return (
    data.close === true ||
    data.closed === true ||
    data.cancel === true ||
    data.cancelled === true ||
    data.canceled === true ||
    type.includes('cancel') ||
    type.includes('close') ||
    status.includes('cancel') ||
    status === 'user_cancelled' ||
    status === 'usercancelledpayment'
  );
}

/**
 * Opens Hubtel Online Checkout via the official `@hubteljs/checkout` SDK (modal, iframe fallback).
 * @see https://developers.hubtel.com — External Checkout SDK
 *
 * Important: Hubtel does NOT auto-close the modal on failure. Their in-checkout
 * "Cancel transaction" button only works if the parent calls `closePopUp()`.
 */
export function HubtelCheckout({ open, purchaseInfo, hubtelConfig, onSuccess, onFailure, onClose }) {
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [useIframe, setUseIframe] = useState(false);
  const started = useRef(false);
  const checkoutRef = useRef(null);
  const finished = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  const onFailureRef = useRef(onFailure);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onFailureRef.current = onFailure;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      started.current = false;
      finished.current = false;
      dismissCheckout(checkoutRef.current);
      checkoutRef.current = null;
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
    finished.current = false;
    let effectAlive = true;

    const finish = (kind, payload) => {
      if (finished.current || !effectAlive) return;
      finished.current = true;
      dismissCheckout(checkoutRef.current);
      checkoutRef.current = null;
      if (kind === 'success') onSuccessRef.current?.(payload);
      else if (kind === 'failure') onFailureRef.current?.(payload);
      else onCloseRef.current?.(payload);
    };

    const onWindowMessage = (event) => {
      if (event.origin !== 'https://unified-pay.hubtel.com') return;
      if (isHubtelCancelOrCloseMessage(event.data)) {
        finish('close', parsePaymentData(event.data?.data ?? event.data));
      }
    };
    window.addEventListener('message', onWindowMessage);

    (async () => {
      setLoading(true);
      setErr('');
      try {
        const checkout = new CheckoutSdk();
        if (!effectAlive) return;
        checkoutRef.current = checkout;

        const callBacks = {
          onInit: () => {
            if (effectAlive) setLoading(false);
          },
          onLoad: () => {
            if (effectAlive) setLoading(false);
          },
          onPaymentSuccess: (response) => {
            const data = parsePaymentData(response?.data ?? response);
            finish('success', data);
          },
          onPaymentFailure: (response) => {
            const data = parsePaymentData(response?.data ?? response);
            /* Hubtel leaves the modal open after failure — must close or Cancel looks broken */
            finish('failure', {
              ...data,
              message: response?.message || data.message || 'Payment failed',
            });
          },
          onClose: () => {
            finish('close', { reason: 'closed' });
          },
        };

        if (typeof checkout.openModal === 'function') {
          checkout.openModal({
            purchaseInfo,
            config: hubtelConfig,
            callBacks,
          });
          if (effectAlive) setLoading(false);
        } else if (typeof checkout.initIframe === 'function') {
          setUseIframe(true);
          await new Promise((r) => requestAnimationFrame(() => r()));
          if (!effectAlive) return;
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
        if (effectAlive) setErr(e.message || 'Could not open Hubtel checkout');
      } finally {
        if (effectAlive) setLoading(false);
      }
    })();

    return () => {
      effectAlive = false;
      window.removeEventListener('message', onWindowMessage);
      dismissCheckout(checkoutRef.current);
      checkoutRef.current = null;
    };
  }, [open, purchaseInfo, hubtelConfig]);

  if (!open) return null;

  const closeNow = () => {
    if (finished.current) {
      onCloseRef.current?.({ reason: 'manual_close' });
      return;
    }
    finished.current = true;
    dismissCheckout(checkoutRef.current);
    checkoutRef.current = null;
    onCloseRef.current?.({ reason: 'manual_close' });
  };

  // Modal path: Hubtel draws its own popup; keep a dismiss control if their Cancel is stuck.
  if (!useIframe) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000001] flex justify-center p-3 sm:p-4">
        <div className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-xl">
          <p className="text-sm text-slate-300">
            {loading ? 'Opening Hubtel checkout…' : err || 'Complete payment in the Hubtel window'}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={closeNow}
          >
            Cancel
          </button>
        </div>
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
            onClick={closeNow}
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

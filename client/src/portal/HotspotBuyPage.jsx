import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicFetch } from '../api.js';
import { usePortalContext, getPortalSlugFromLocation } from './usePortalContext.js';
import { DraftCheckoutPrompt } from './DraftCheckoutPrompt.jsx';
import { HubtelCheckout } from './HubtelCheckout.jsx';
import { PortalBrandHeader } from './PortalBrandHeader.jsx';

function formatDuration(p) {
  const amount = p.durationAmount ?? p.durationDays;
  const unit = p.durationUnit || (p.durationDays ? 'day' : '');
  if (amount == null || !unit) return null;
  const label = Number(amount) === 1 ? unit : `${unit}s`;
  return `${amount} ${label}`;
}

function formatData(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1)} MB`;
  return `${(n / 1073741824).toFixed(n % 1073741824 === 0 ? 0 : 1)} GB`;
}

function formatSession(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 3600) return `${Math.round(n / 60)} min online`;
  if (n < 86400) return `${(n / 3600).toFixed(n % 3600 === 0 ? 0 : 1)} hr online`;
  return `${(n / 86400).toFixed(n % 86400 === 0 ? 0 : 1)} day online`;
}

/**
 * Hotspot buy is always bound to the current site:
 * - captive / QR link `?r=site-slug`, or
 * - automatic match when the customer is on that site’s public IP.
 * Customers never pick a router/location.
 */
export function HotspotBuyPage() {
  const navigate = useNavigate();
  const { ctx, loading: ctxLoading, error: ctxError } = usePortalContext();
  const [packages, setPackages] = useState([]);
  const [packageId, setPackageId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draftCheckout, setDraftCheckout] = useState(null);
  const [hubtelSession, setHubtelSession] = useState(null);

  const siteReady = Boolean(ctx?.resolved && ctx.router?.id);
  const slug = getPortalSlugFromLocation();
  const brandName = String(ctx?.branding?.displayName || '').trim() || 'Wi‑Fi';

  useEffect(() => {
    if (!siteReady) {
      setPackages([]);
      setPackageId('');
      return;
    }
    const qs = slug ? `?r=${encodeURIComponent(slug)}` : '';
    publicFetch(`/api/public/packages/hotspot${qs}`)
      .then((p) => {
        setPackages(Array.isArray(p) ? p : []);
        if (p?.[0]) setPackageId(p[0]._id);
      })
      .catch((e) => setError(e.message));
  }, [siteReady, slug]);

  async function onPay(e) {
    e.preventDefault();
    setError('');
    if (!siteReady) {
      setError('This site could not be detected. Connect to the venue Wi‑Fi or use the buy link from the login page.');
      return;
    }
    if (!packageId) {
      setError('Select a package.');
      return;
    }
    setLoading(true);
    try {
      const data = await publicFetch('/api/public/hotspot/checkout', {
        method: 'POST',
        body: JSON.stringify({
          packageId,
          portalSlug: getPortalSlugFromLocation() || undefined,
          customerName: undefined,
        }),
      });
      if (data.mode === 'draft_hubtel' || data.mode === 'draft_momo') {
        setDraftCheckout(data);
        return;
      }
      if (data.mode === 'hubtel_checkout' && data.purchaseInfo && data.hubtelConfig) {
        setHubtelSession(data);
        return;
      }
      if (!data.checkoutUrl) {
        setError('No payment session returned. Try again or contact support.');
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-[70vh]">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950/40 via-slate-950 to-slate-950"
        aria-hidden
      />
      <div className="mx-auto max-w-md px-4 py-10">
        <DraftCheckoutPrompt
          open={!!draftCheckout}
          payload={draftCheckout}
          onClose={() => setDraftCheckout(null)}
          onComplete={(ref) =>
            navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`)
          }
        />
        <HubtelCheckout
          open={!!hubtelSession}
          purchaseInfo={hubtelSession?.purchaseInfo}
          hubtelConfig={hubtelSession?.hubtelConfig}
          onClose={() => {
            const ref = hubtelSession?.clientReference;
            if (ref) {
              publicFetch('/api/public/payment/hubtel-client-event', {
                method: 'POST',
                body: JSON.stringify({ clientReference: ref, event: 'cancelled', payload: {} }),
              }).catch(() => {});
            }
            setHubtelSession(null);
          }}
          onFailure={(payload) => {
            const ref = hubtelSession?.clientReference;
            if (ref) {
              publicFetch('/api/public/payment/hubtel-client-event', {
                method: 'POST',
                body: JSON.stringify({ clientReference: ref, event: 'failure', payload }),
              }).catch(() => {});
            }
            setError('Payment was not completed. You can try again.');
            setHubtelSession(null);
          }}
          onSuccess={(payload) => {
            const ref = hubtelSession?.clientReference;
            setHubtelSession(null);
            if (ref) {
              publicFetch('/api/public/payment/hubtel-client-event', {
                method: 'POST',
                body: JSON.stringify({ clientReference: ref, event: 'success', payload }),
              }).catch(() => {});
              navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`);
            }
          }}
        />
        <PortalBrandHeader
          branding={ctx?.branding}
          routerName={siteReady ? ctx?.router?.name : ''}
          title={`Get online with ${brandName}`}
          subtitle={
            ctxLoading
              ? 'Detecting your location…'
              : siteReady
                ? 'Choose a time or data package for this venue. After payment you will get a login code for the captive portal.'
                : 'Access is sold per venue. Use the buy link from the login page or connect to venue Wi‑Fi.'
          }
        />

        {ctxError && (
          <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {ctxError}
          </p>
        )}

        {!ctxLoading && !siteReady && (
          <div className="mt-6 rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
            <p className="font-medium text-amber-50">Location not detected</p>
            <p className="mt-2 text-amber-100/90">
              Connect to this venue&apos;s Wi‑Fi and open the buy page again, or use the QR / login-page link
              for this site. Location cannot be chosen manually.
            </p>
          </div>
        )}

        {siteReady && (
          <form onSubmit={onPay} className="mt-8 space-y-4">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-300">Packages</legend>
              {packages.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-4 text-sm text-slate-500">
                  No packages available at this venue right now.
                </p>
              ) : (
                packages.map((p) => {
                  const selected = String(packageId) === String(p._id);
                  const duration = formatDuration(p);
                  const data = formatData(p.dataLimitBytes);
                  const session = formatSession(p.timeLimitSeconds);
                  return (
                    <label
                      key={p._id}
                      className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition ${
                        selected
                          ? 'border-emerald-500/60 bg-emerald-950/30 ring-1 ring-emerald-500/40'
                          : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="package"
                        className="mt-1"
                        checked={selected}
                        onChange={() => setPackageId(p._id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-medium text-white">{p.name}</span>
                          <span className="shrink-0 text-sm font-semibold text-emerald-300">
                            {(Number(p.priceCents) / 100).toFixed(2)} {p.currency || 'GHS'}
                          </span>
                        </span>
                        {(duration || data || session || p.description) && (
                          <span className="mt-1 block text-xs text-slate-400">
                            {[duration && `Valid ${duration}`, data && `${data} data`, session, p.description]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })
              )}
            </fieldset>
            {error && (
              <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !packages.length}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Please wait…' : 'Proceed to checkout'}
            </button>
            <p className="text-center text-xs text-slate-500">
              After payment, enter the voucher code on the Wi‑Fi login screen (username and password).
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

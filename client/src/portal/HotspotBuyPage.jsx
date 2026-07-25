import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicFetch } from '../api.js';
import { usePortalContext, getPortalSlugFromLocation } from './usePortalContext.js';
import { DraftCheckoutPrompt } from './DraftCheckoutPrompt.jsx';
import { HubtelCheckout } from './HubtelCheckout.jsx';
import { PortalBrandHeader } from './PortalBrandHeader.jsx';

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
        onClose={() => setHubtelSession(null)}
        onFailure={() => {
          setError('Payment was not completed. You can try again.');
          setHubtelSession(null);
        }}
        onSuccess={() => {
          const ref = hubtelSession?.clientReference;
          setHubtelSession(null);
          if (ref) navigate(`/portal/pay/return?ref=${encodeURIComponent(ref)}`);
        }}
      />
      <PortalBrandHeader
        branding={ctx?.branding}
        routerName={siteReady ? ctx?.router?.name : ''}
        title="Buy hotspot access"
        subtitle={
          ctxLoading
            ? 'Detecting your location…'
            : siteReady
              ? 'Choose a package for this venue.'
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
          <label className="block text-sm">
            <span className="text-slate-300">Package</span>
            <select
              required
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5"
            >
              {packages.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} — {(p.priceCents / 100).toFixed(2)} {p.currency}
                </option>
              ))}
            </select>
          </label>
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
        </form>
      )}
    </div>
  );
}

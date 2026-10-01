import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { RenewPage } from './RenewPage.jsx';
import { HotspotBuyPage } from './HotspotBuyPage.jsx';
import { PayReturnPage } from './PayReturnPage.jsx';
import { PayMockPage } from './PayMockPage.jsx';
import { CaptiveLoginPage } from './CaptiveLoginPage.jsx';

/**
 * Two separate customer journeys:
 * - Wi‑Fi tickets (/portal/hotspot, /portal/wifi): opened from the hotspot login page, venue-branded, no PPPoE links.
 * - PPPoE renewal (/portal/renew): home internet customers.
 * The payment result page serves both and picks its links from the payment kind.
 */
export function PublicPortal() {
  const { pathname } = useLocation();
  if (/\/login\/?$/.test(pathname)) {
    return <CaptiveLoginPage />;
  }

  if (/\/portal\/(hotspot|wifi)\/?$/.test(pathname)) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <HotspotBuyPage />
      </div>
    );
  }

  if (/\/portal\/pay\//.test(pathname)) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Routes>
          <Route path="pay/return" element={<PayReturnPage />} />
          <Route path="pay/mock" element={<PayMockPage />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <span className="shrink-0 font-semibold text-white">Internet renewal</span>
          <Link to="/portal/renew" className="whitespace-nowrap text-sm text-slate-400 hover:text-emerald-400">
            Renew PPPoE
          </Link>
        </div>
      </header>
      <Routes>
        <Route path="renew" element={<RenewPage />} />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-lg px-4 py-10 text-center text-slate-500">
              <p>Customer self-service</p>
              <Link to="/portal/renew" className="mt-4 inline-block text-emerald-400">
                Renew PPPoE
              </Link>
            </div>
          }
        />
      </Routes>
    </div>
  );
}

import { Routes, Route, Link } from 'react-router-dom';
import { RenewPage } from './RenewPage.jsx';
import { HotspotBuyPage } from './HotspotBuyPage.jsx';
import { PayReturnPage } from './PayReturnPage.jsx';
import { PayMockPage } from './PayMockPage.jsx';

export function PublicPortal() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90">
        <div className="mx-auto flex max-w-lg flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="shrink-0 font-semibold text-white">QareFi</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400 sm:justify-end">
            <Link to="/portal/renew" className="whitespace-nowrap hover:text-emerald-400">
              Renew PPPoE
            </Link>
            <Link to="/portal/hotspot" className="whitespace-nowrap hover:text-emerald-400">
              Buy hotspot
            </Link>
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="renew" element={<RenewPage />} />
        <Route path="hotspot" element={<HotspotBuyPage />} />
        <Route path="pay/return" element={<PayReturnPage />} />
        <Route path="pay/mock" element={<PayMockPage />} />
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

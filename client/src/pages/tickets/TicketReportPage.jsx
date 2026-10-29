import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../api.js';
import { TicketReportsPage } from './TicketReportsPage.jsx';
import { TicketSalesReportPage } from './TicketSalesReportPage.jsx';

const TABS = [
  { id: 'sellers', label: 'Sellers & cash', hint: 'What sellers owe now, and what was issued, collected and returned.' },
  { id: 'sales', label: 'Sales', hint: 'Tickets sold and money made per site, plan, seller and day.' },
];

/** One report page: seller balances and cash, and ticket sales. */
export function TicketReportPage() {
  const [params, setParams] = useSearchParams();
  const [canSeeSales, setCanSeeSales] = useState(false);
  const tab = params.get('view') === 'sales' && canSeeSales ? 'sales' : 'sellers';

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((me) => setCanSeeSales(me?.admin?.role !== 'ticket_manager'))
      .catch(() => {});
  }, []);

  const tabs = canSeeSales ? TABS : TABS.slice(0, 1);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Ticket report</h1>
        <p className="mt-1 text-sm text-slate-400">{TABS.find((t) => t.id === tab)?.hint}</p>
      </div>
      {tabs.length > 1 ? (
        <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setParams(t.id === 'sellers' ? {} : { view: t.id })}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
                tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'sales' ? <TicketSalesReportPage embedded /> : <TicketReportsPage embedded />}
    </div>
  );
}

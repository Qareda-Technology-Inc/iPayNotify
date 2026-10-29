import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';

/**
 * Sites (one per router, plus old sites without a router) with their sellers and each seller's
 * position: holdingQty, usedQty (sold), balanceCents (owes; negative = paid ahead).
 */
export function useTicketOps() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch('/api/ticket-sales/ops/overview');
      setSites(Array.isArray(d?.sites) ? d.sites : []);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not load sites and sellers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { sites, loading, err, reload };
}

export const inputCls =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500';

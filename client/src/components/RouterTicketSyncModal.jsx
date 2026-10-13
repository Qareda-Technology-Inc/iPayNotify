import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';
import { FormError, Modal, btnPrimary, btnSecondary, inputCls, labelCls } from './Modal.jsx';

function Stat({ label, value, tone = 'text-white' }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${tone}`}>{value ?? '—'}</p>
    </div>
  );
}

/**
 * Compare unused tickets in the system with the router's hotspot users and add the missing ones.
 */
export function RouterTicketSyncModal({ open, onClose, routers, initialRouterId, onSynced }) {
  const [routerId, setRouterId] = useState('');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setRouterId(initialRouterId || routers[0]?._id || '');
    setCheck(null);
    setProgress(null);
    setErr('');
  }, [open, initialRouterId, routers]);

  const runCheck = useCallback(async (id) => {
    if (!id) return;
    setChecking(true);
    setErr('');
    try {
      setCheck(
        await apiFetch(`/api/hotspot/routers/${id}/sync-tickets`, {
          method: 'POST',
          body: JSON.stringify({ dryRun: true }),
        })
      );
    } catch (e) {
      setCheck(null);
      setErr(e.message || 'Could not read tickets from the router');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (open && routerId) {
      setProgress(null);
      runCheck(routerId);
    }
  }, [open, routerId, runCheck]);

  async function addMissing() {
    if (!routerId) return;
    setSyncing(true);
    setErr('');
    const total = { pushed: 0, failed: [], skippedNoPlan: 0, target: check?.missing || 0 };
    setProgress({ ...total });
    try {
      for (let round = 0; round < 50; round += 1) {
        const r = await apiFetch(`/api/hotspot/routers/${routerId}/sync-tickets`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        total.pushed += r.pushed || 0;
        total.failed = r.failed || [];
        total.skippedNoPlan = r.skippedNoPlan || 0;
        setProgress({ ...total });
        if (!r.remaining || !r.pushed) break;
      }
      onSynced?.();
    } catch (e) {
      setErr(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
      runCheck(routerId);
    }
  }

  const missing = check?.missing || 0;

  return (
    <Modal
      open={open}
      title="Sync tickets to router"
      subtitle="Adds unused tickets that are in the system but missing on the router."
      onClose={syncing ? undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={syncing} className={btnSecondary}>
            Close
          </button>
          <button type="button" onClick={addMissing} disabled={syncing || checking || !missing} className={btnPrimary}>
            {syncing ? 'Adding…' : missing ? `Add ${missing} missing ticket${missing === 1 ? '' : 's'}` : 'Nothing to add'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className={labelCls}>
          Router
          <select
            value={routerId}
            disabled={syncing}
            onChange={(e) => setRouterId(e.target.value)}
            className={inputCls}
          >
            {routers.map((r) => (
              <option key={r._id} value={r._id}>
                {routerDisplayName(r)}
              </option>
            ))}
          </select>
        </label>

        {checking ? (
          <p className="text-sm text-slate-400">Reading hotspot users from the router…</p>
        ) : check ? (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Unused in system" value={check.unusedInSystem} />
            <Stat label="On router" value={check.onRouter} tone="text-emerald-300" />
            <Stat label="Missing" value={check.missing} tone={check.missing ? 'text-amber-300' : 'text-white'} />
          </div>
        ) : null}

        {check && !check.missing && !checking && !progress ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Every unused ticket is on the router.
          </p>
        ) : null}

        {progress ? (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-sm text-slate-300">
            <p>
              Added <strong className="text-white">{progress.pushed}</strong>
              {progress.target ? ` of ${progress.target}` : ''} ticket{progress.pushed === 1 ? '' : 's'}
              {syncing ? '…' : '.'}
            </p>
            {progress.skippedNoPlan ? (
              <p className="mt-1 text-xs text-amber-300">
                {progress.skippedNoPlan} skipped because their plan was deleted.
              </p>
            ) : null}
            {progress.failed.length ? (
              <div className="mt-2 text-xs text-red-300">
                <p>{progress.failed.length} rejected by the router:</p>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono">
                  {progress.failed.slice(0, 20).map((f) => (
                    <li key={f.id}>
                      {f.code} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-[11px] text-slate-500">
          Tickets already used are not re-added, so nobody gets their time reset.
        </p>
        {err ? <FormError>{err}</FormError> : null}
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { apiFetch } from '../api.js';

function shortKey(k) {
  const s = String(k || '');
  return s.length <= 16 ? s : `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function ago(unixSeconds) {
  if (!unixSeconds) return 'never';
  const s = Math.max(0, Math.round(Date.now() / 1000 - unixSeconds));
  if (s < 120) return `${s}s ago`;
  if (s < 7200) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const selectCls = 'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white';

/** One unknown live peer: name it and say whose it is, so it is switched off with that organisation. */
function AdoptForm({ peer, orgs, onDone, onError }) {
  const [label, setLabel] = useState('');
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);

  async function adopt(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/super-admin/wireguard/vps-peers/adopt', {
        method: 'POST',
        body: JSON.stringify({ publicKey: peer.publicKey, label: label.trim(), organizationId: orgId }),
      });
      onDone(`Recorded ${label.trim()}. It now switches off with its organisation.`);
    } catch (e2) {
      onError(e2.message || 'Could not record it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={adopt} className="mt-2 flex flex-wrap items-center gap-1.5">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Whose device?"
        required
        minLength={2}
        className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
      />
      <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required className={selectCls}>
        <option value="">Organisation…</option>
        <option value="platform">Platform staff</option>
        {orgs.map((o) => (
          <option key={o._id} value={o._id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Record'}
      </button>
    </form>
  );
}

/**
 * What is really live on the VPS right now. A peer here can connect, whatever the database says,
 * so this is where access is cut for good.
 */
export function VpsPeersPanel({ orgs, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  async function check() {
    setLoading(true);
    setErr('');
    try {
      setData(await apiFetch('/api/super-admin/wireguard/vps-peers'));
    } catch (e) {
      setErr(e.message || 'Could not read the VPS');
    } finally {
      setLoading(false);
    }
  }

  async function remove(p) {
    const name = p.record?.siteName || `unknown peer ${shortKey(p.publicKey)}`;
    if (!window.confirm(`Cut ${name} off the VPS now? It can no longer connect.`)) return;
    setBusyKey(p.publicKey);
    setErr('');
    setInfo('');
    try {
      await apiFetch('/api/super-admin/wireguard/vps-peers/remove', {
        method: 'POST',
        body: JSON.stringify({ publicKey: p.publicKey }),
      });
      setInfo(`${name} removed from the VPS.`);
      await check();
      onChanged?.();
    } catch (e) {
      setErr(e.message || 'Could not remove it');
    } finally {
      setBusyKey('');
    }
  }

  const unknown = data?.peers?.filter((p) => !p.record).length || 0;
  const stale = data?.peers?.filter((p) => p.shouldBeOff).length || 0;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-white">Live on the VPS</h3>
          <p className="mt-1 text-xs text-slate-400">
            Every peer the VPS lets in right now, read from the VPS itself. Anything listed here can connect, whatever
            the records above say.
          </p>
        </div>
        <button
          type="button"
          onClick={check}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? 'Reading VPS…' : data ? 'Check again' : 'Check VPS'}
        </button>
      </div>

      {err ? <p className="mt-3 text-xs text-red-300">{err}</p> : null}
      {info ? <p className="mt-3 text-xs text-emerald-300">{info}</p> : null}

      {data ? (
        <>
          <p className={`mt-3 text-xs ${unknown || stale ? 'text-amber-200' : 'text-emerald-300'}`}>
            {data.peers.length} peer{data.peers.length === 1 ? '' : 's'} live
            {unknown ? ` · ${unknown} not recorded here` : ''}
            {stale ? ` · ${stale} switched off here but still live` : ''}
            {!unknown && !stale ? ' · all match the records' : ''}
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Peer</th>
                  <th className="px-3 py-2 font-medium">Tunnel IP</th>
                  <th className="px-3 py-2 font-medium">Connects from</th>
                  <th className="px-3 py-2 font-medium">Last handshake</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {data.peers.map((p) => (
                  <tr key={p.publicKey} className="align-top text-slate-300">
                    <td className="px-3 py-2.5">
                      {p.record ? (
                        <>
                          <p className="text-slate-100">{p.record.siteName}</p>
                          <p className="text-[11px] text-slate-500">
                            {p.record.kind === 'client' ? 'Phone / laptop' : 'Router'}
                          </p>
                        </>
                      ) : (
                        <p className="text-amber-200">Not recorded here</p>
                      )}
                      <p className="font-mono text-[11px] text-slate-500" title={p.publicKey}>
                        {shortKey(p.publicKey)}
                      </p>
                      {p.shouldBeOff ? (
                        <p className="mt-1 text-[11px] text-red-300">Switched off here but still live: remove it</p>
                      ) : null}
                      {!p.record ? (
                        <AdoptForm
                          peer={p}
                          orgs={orgs}
                          onDone={async (msg) => {
                            setInfo(msg);
                            await check();
                            onChanged?.();
                          }}
                          onError={setErr}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-emerald-200">
                      {p.allowedIps.join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{p.endpoint || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{ago(p.latestHandshake)}</td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        disabled={busyKey === p.publicKey}
                        onClick={() => remove(p)}
                        className="rounded border border-red-700/40 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                      >
                        {busyKey === p.publicKey ? 'Removing…' : 'Remove from VPS'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.missing?.length ? (
            <p className="mt-3 text-xs text-slate-400">
              On here but missing on the VPS (Resync puts them back): {data.missing.map((m) => m.siteName).join(', ')}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

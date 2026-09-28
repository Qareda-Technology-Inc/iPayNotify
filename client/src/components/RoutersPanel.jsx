import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName as routerLabel } from '../utils/routerDisplayName.js';
import { AddRouterWizard } from './AddRouterWizard.jsx';

function connectDisplay(r) {
  if (!r?.host) return '';
  if (r.transport === 'ssh') {
    const p = Number(r.sshPort) || 22;
    return p === 22 ? r.host : `${r.host}:${p}`;
  }
  const p = Number(r.apiPort) || 8728;
  return p === 8728 ? r.host : `${r.host}:${p}`;
}

function fieldClass() {
  return 'mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20';
}

export function RoutersPanel() {
  const [routers, setRouters] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState('');
  const [connMessage, setConnMessage] = useState('');
  const [connError, setConnError] = useState('');
  const [testing, setTesting] = useState(false);
  const [detailTab, setDetailTab] = useState('access');

  const [editComment, setEditComment] = useState('');
  const [editConnect, setEditConnect] = useState('');
  const [editTransport, setEditTransport] = useState('ssh');
  const [editUser, setEditUser] = useState('');
  const [editNewPass, setEditNewPass] = useState('');
  const [editDefaultPpp, setEditDefaultPpp] = useState('default');
  const [editExpiredPpp, setEditExpiredPpp] = useState('nonpayment');
  const [editSitePublicIp, setEditSitePublicIp] = useState('');
  const [editPortalSlug, setEditPortalSlug] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [liveSnap, setLiveSnap] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');

  const loadRouters = useCallback(async () => {
    setListError('');
    const list = await apiFetch('/api/routers');
    const arr = Array.isArray(list) ? list : [];
    setRouters(arr);
    return arr;
  }, []);

  useEffect(() => {
    setListLoading(true);
    loadRouters()
      .then((arr) => {
        if (Array.isArray(arr) && arr.length === 0) setShowAdd(true);
      })
      .catch((e) => setListError(e.message))
      .finally(() => setListLoading(false));
  }, [loadRouters]);

  const selected = routers.find((r) => String(r._id) === String(selectedId));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routers;
    return routers.filter((r) => {
      const name = routerLabel(r).toLowerCase();
      const host = String(r.host || '').toLowerCase();
      const tunnel = String(r.wireguard?.tunnelIp || '').toLowerCase();
      return name.includes(q) || host.includes(q) || tunnel.includes(q);
    });
  }, [routers, query]);

  const vpnCount = useMemo(
    () => routers.filter((r) => Boolean(r.wireguard?.tunnelIp)).length,
    [routers]
  );

  useEffect(() => {
    if (!selected) return;
    setEditComment(
      selected.comment != null && String(selected.comment).trim()
        ? String(selected.comment).trim()
        : selected.name || ''
    );
    setEditConnect(connectDisplay(selected));
    setEditTransport(selected.transport === 'ssh' ? 'ssh' : 'api');
    setEditUser(selected.apiUser || '');
    setEditNewPass('');
    setEditDefaultPpp(selected.defaultPppProfile || 'default');
    setEditExpiredPpp(selected.expiredPppProfile || 'nonpayment');
    setEditSitePublicIp(selected.sitePublicIp || '');
    setEditPortalSlug(selected.portalSlug || '');
    setConnMessage('');
    setConnError('');
    setSaveError('');
    setLiveSnap(null);
    setLiveError('');
    setDetailTab('access');
  }, [selected]);

  useEffect(() => {
    if (routers.length && !selectedId) setSelectedId(String(routers[0]._id));
    if (selectedId && !routers.some((r) => String(r._id) === String(selectedId))) {
      setSelectedId(routers[0] ? String(routers[0]._id) : '');
    }
  }, [routers, selectedId]);

  useEffect(() => {
    if (!mobileDetailOpen && !showAdd) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileDetailOpen, showAdd]);

  useEffect(() => {
    if (!mobileDetailOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileDetailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileDetailOpen]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(''), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  function selectRouter(id) {
    setSelectedId(String(id));
    setMobileDetailOpen(true);
  }

  function copyText(value) {
    const v = String(value || '');
    if (!v) return;
    navigator.clipboard.writeText(v).then(
      () => setCopied(v),
      () => {}
    );
  }

  async function testConnection() {
    if (!selectedId) return;
    setConnError('');
    setConnMessage('');
    setTesting(true);
    try {
      const r = await apiFetch(`/api/routers/${selectedId}/mikrotik/ping`);
      setConnMessage(r.message || 'Connected');
    } catch (e) {
      setConnError(e.message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  }

  async function fetchLive() {
    if (!selectedId) return;
    setLiveLoading(true);
    setLiveError('');
    try {
      const snap = await apiFetch(`/api/routers/${selectedId}/mikrotik/live`);
      setLiveSnap(snap);
      if (snap.error) setLiveError(snap.error);
      setDetailTab('live');
    } catch (e) {
      setLiveSnap(null);
      setLiveError(e.message || 'Fetch failed');
    } finally {
      setLiveLoading(false);
    }
  }

  async function saveEdits(e) {
    e.preventDefault();
    if (!selectedId) return;
    setSaveError('');
    setSaving(true);
    try {
      const body = {
        comment: editComment.trim(),
        host: editConnect.trim(),
        transport: editTransport,
        apiUser: editUser,
        defaultPppProfile: editDefaultPpp,
        expiredPppProfile: editExpiredPpp,
        sitePublicIp: editSitePublicIp.trim(),
        portalSlug: editPortalSlug.trim().toLowerCase(),
      };
      if (editNewPass.trim()) body.apiPassword = editNewPass;
      await apiFetch(`/api/routers/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditNewPass('');
      await loadRouters();
      setConnMessage('Saved');
      setDetailTab('access');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const detailProps = {
    selected,
    detailTab,
    setDetailTab,
    testing,
    testConnection,
    connMessage,
    connError,
    editComment,
    setEditComment,
    editConnect,
    setEditConnect,
    editUser,
    setEditUser,
    editNewPass,
    setEditNewPass,
    editDefaultPpp,
    setEditDefaultPpp,
    editExpiredPpp,
    setEditExpiredPpp,
    editPortalSlug,
    setEditPortalSlug,
    editSitePublicIp,
    setEditSitePublicIp,
    editTransport,
    setEditTransport,
    saveEdits,
    saveError,
    saving,
    liveLoading,
    fetchLive,
    liveError,
    liveSnap,
    copyText,
    copied,
  };

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4 overflow-x-hidden sm:space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">Routers</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {listLoading
              ? 'Loading sites…'
              : `${routers.length} site${routers.length === 1 ? '' : 's'}${
                  vpnCount ? ` · ${vpnCount} on VPN` : ''
                }`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm shadow-emerald-900/30 hover:bg-emerald-500 sm:h-10"
        >
          Add router
        </button>
      </header>

      {listError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
          {listError}
        </p>
      ) : null}

      {listLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-slate-800/80 bg-slate-900/40"
            />
          ))}
        </div>
      ) : routers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/20 px-5 py-14 text-center sm:px-8">
          <p className="text-base font-medium text-white">No routers yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            Add a site with its IP and login. We create the WireGuard tunnel and save remote access
            endpoints for you.
          </p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Add your first router
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, IP, or tunnel…"
              className="h-11 w-full rounded-xl border border-slate-800 bg-slate-900/60 pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
            />
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3-3" strokeLinecap="round" />
            </svg>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/30">
              {filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">No sites match “{query}”.</p>
              ) : (
                <ul className="divide-y divide-slate-800/80">
                  {filtered.map((r) => {
                    const active = String(r._id) === String(selectedId);
                    const tunnel = r.wireguard?.tunnelIp;
                    return (
                      <li key={r._id}>
                        <button
                          type="button"
                          onClick={() => selectRouter(r._id)}
                          className={`flex w-full min-w-0 items-center gap-3 px-4 py-3.5 text-left transition sm:px-5 ${
                            active
                              ? 'bg-emerald-950/35 sm:bg-emerald-950/25'
                              : 'hover:bg-slate-800/40 active:bg-slate-800/60'
                          }`}
                        >
                          <span
                            className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                              tunnel ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]' : 'bg-slate-600'
                            }`}
                            title={tunnel ? 'On VPN' : 'Direct'}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium text-white">{routerLabel(r)}</span>
                              <span
                                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                  tunnel
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-slate-800 text-slate-500'
                                }`}
                              >
                                {tunnel ? 'VPN' : 'Direct'}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-xs text-slate-500">
                              {tunnel
                                ? `Winbox ${r.wireguard.endpoints?.winbox || `${tunnel}:8291`}`
                                : r.host}
                            </span>
                          </span>
                          <svg
                            className="h-4 w-4 shrink-0 text-slate-600 lg:hidden"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden
                          >
                            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <aside className="hidden min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto">
              <div className="p-5">
                <RouterDetail {...detailProps} />
              </div>
            </aside>
          </div>
        </>
      )}

      {mobileDetailOpen && selected ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
            aria-label="Close"
            onClick={() => setMobileDetailOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[min(94dvh,94vh)] flex-col rounded-t-2xl border border-slate-700/80 border-b-0 bg-slate-900 shadow-2xl">
            <div className="relative flex shrink-0 items-center justify-center border-b border-slate-800 px-4 pb-3 pt-3">
              <div className="h-1 w-10 rounded-full bg-slate-600" aria-hidden />
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="absolute right-2 top-1.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <RouterDetail {...detailProps} />
            </div>
          </div>
        </div>
      ) : null}

      {showAdd ? (
        <AddRouterWizard
          onCancel={() => setShowAdd(false)}
          onCreated={async (data) => {
            setShowAdd(false);
            await loadRouters();
            const id = data?.router?.id;
            if (id) {
              setSelectedId(String(id));
              setMobileDetailOpen(true);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function RouterDetail({
  selected,
  detailTab,
  setDetailTab,
  testing,
  testConnection,
  connMessage,
  connError,
  editComment,
  setEditComment,
  editConnect,
  setEditConnect,
  editUser,
  setEditUser,
  editNewPass,
  setEditNewPass,
  editDefaultPpp,
  setEditDefaultPpp,
  editExpiredPpp,
  setEditExpiredPpp,
  editPortalSlug,
  setEditPortalSlug,
  editSitePublicIp,
  setEditSitePublicIp,
  editTransport,
  setEditTransport,
  saveEdits,
  saveError,
  saving,
  liveLoading,
  fetchLive,
  liveError,
  liveSnap,
  copyText,
  copied,
}) {
  if (!selected) {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center text-center">
        <p className="text-sm text-slate-500">Select a site from the list</p>
      </div>
    );
  }

  const onVpn = Boolean(selected.wireguard?.tunnelIp);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-white">
            {routerLabel(selected)}
          </h3>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              onVpn
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25'
                : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700'
            }`}
          >
            {onVpn ? 'On VPN' : 'Direct'}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-slate-500">{selected.host}</p>
        {selected.wireguard?.lanSubnet ? (
          <p className="mt-1 text-xs text-slate-500">
            LAN <span className="font-mono text-slate-400">{selected.wireguard.lanSubnet}</span>
          </p>
        ) : null}
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-950/80 p-1">
        {[
          { id: 'access', label: 'Access' },
          { id: 'settings', label: 'Settings' },
          { id: 'live', label: 'Live' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setDetailTab(t.id)}
            className={`min-h-10 flex-1 rounded-lg text-xs font-semibold transition sm:min-h-9 ${
              detailTab === t.id
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {detailTab === 'access' && (
        <div className="space-y-4">
          {selected.wireguard?.endpoints ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Remote over VPN
              </p>
              {[
                { label: 'Winbox', value: selected.wireguard.endpoints.winbox },
                { label: 'SSH', value: selected.wireguard.endpoints.ssh },
                { label: 'API', value: selected.wireguard.endpoints.api },
              ].map((ep) => {
                const justCopied = copied === ep.value;
                return (
                  <div
                    key={ep.label}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {ep.label}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-sm text-emerald-100">{ep.value}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(ep.value)}
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                        justCopied
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {justCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-sm text-slate-400">
              No VPN tunnel linked yet. Use <strong className="text-slate-200">Add router</strong> →
              download the .rsc, import it on the MikroTik, then finish with the admin login.
            </div>
          )}

          <button
            type="button"
            disabled={testing}
            onClick={testConnection}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-emerald-600/40 bg-emerald-950/40 text-sm font-semibold text-emerald-100 hover:bg-emerald-950/70 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {connMessage ? <p className="text-sm text-emerald-400">{connMessage}</p> : null}
          {connError ? (
            <p className="break-words whitespace-pre-wrap rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
              {connError}
            </p>
          ) : null}
        </div>
      )}

      {detailTab === 'settings' && (
        <form onSubmit={saveEdits} className="space-y-4">
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Site</p>
            <label className="block text-xs font-medium text-slate-400">
              Name
              <input
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                className={fieldClass()}
              />
            </label>
            <label className="block text-xs font-medium text-slate-400">
              Host
              <input
                required
                value={editConnect}
                onChange={(e) => setEditConnect(e.target.value)}
                className={`${fieldClass()} font-mono`}
              />
            </label>
            <label className="block text-xs font-medium text-slate-400">
              Transport
              <select
                value={editTransport}
                onChange={(e) => setEditTransport(e.target.value)}
                className={fieldClass()}
              >
                <option value="ssh">SSH</option>
                <option value="api">API</option>
              </select>
            </label>
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Login</p>
            <label className="block text-xs font-medium text-slate-400">
              Username
              <input
                required
                value={editUser}
                onChange={(e) => setEditUser(e.target.value)}
                className={fieldClass()}
              />
            </label>
            <label className="block text-xs font-medium text-slate-400">
              New password
              <input
                type="password"
                value={editNewPass}
                onChange={(e) => setEditNewPass(e.target.value)}
                placeholder="Leave blank to keep"
                className={fieldClass()}
              />
            </label>
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Profiles & portal
            </p>
            <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
              <label className="block text-xs font-medium text-slate-400">
                Active PPP
                <input
                  value={editDefaultPpp}
                  onChange={(e) => setEditDefaultPpp(e.target.value)}
                  className={`${fieldClass()} font-mono text-xs`}
                />
              </label>
              <label className="block text-xs font-medium text-slate-400">
                Expired PPP
                <input
                  value={editExpiredPpp}
                  onChange={(e) => setEditExpiredPpp(e.target.value)}
                  className={`${fieldClass()} font-mono text-xs`}
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-slate-400">
              Portal slug
              <input
                value={editPortalSlug}
                onChange={(e) =>
                  setEditPortalSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                className={`${fieldClass()} font-mono`}
              />
            </label>
            <label className="block text-xs font-medium text-slate-400">
              Site public IP
              <input
                value={editSitePublicIp}
                onChange={(e) => setEditSitePublicIp(e.target.value)}
                className={`${fieldClass()} font-mono`}
              />
            </label>
          </div>

          {saveError ? <p className="text-xs text-red-300">{saveError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}

      {detailTab === 'live' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Pull live sessions and users from the site.</p>
          <button
            type="button"
            disabled={liveLoading}
            onClick={fetchLive}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-sky-600/35 bg-sky-950/30 text-sm font-semibold text-sky-100 hover:bg-sky-950/50 disabled:opacity-50"
          >
            {liveLoading ? 'Fetching…' : 'Fetch from site'}
          </button>
          {liveError ? (
            <p className="break-words rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
              {liveError}
            </p>
          ) : null}
          {liveSnap ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'PPP online', value: liveSnap.counts?.pppActive ?? 0 },
                { label: 'Hotspot', value: liveSnap.counts?.hotspotActive ?? 0 },
                { label: 'PPP secrets', value: liveSnap.counts?.pppSecrets ?? 0 },
                { label: 'HS users', value: liveSnap.counts?.hotspotUsers ?? 0 },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3 text-center"
                >
                  <p className="text-[11px] text-slate-500">{c.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-white">{c.value}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

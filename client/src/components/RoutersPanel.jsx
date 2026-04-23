import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName as routerLabel } from '../utils/routerDisplayName.js';

/** Winbox (8291) vs RouterOS API (8728) — SSH uses port 22, same CLI as terminal. */
function ApiPortHint({ port }) {
  const n = Number(port);
  if (Number.isNaN(n)) return null;
  if (n === 8291) {
    return (
      <p className="mt-1.5 text-xs text-amber-300">
        <strong>8291 is Winbox only.</strong> QareFi connects to the <strong>api</strong> service, not
        Winbox. Use port <strong>8728</strong> unless you changed it under IP → Services → api.
      </p>
    );
  }
  if (n === 8729) {
    return (
      <p className="mt-1.5 text-xs text-amber-300">
        <strong>8729</strong> is usually encrypted API (api-ssl). This app uses plain API on{' '}
        <strong>8728</strong> unless your router uses a custom port for the non-SSL api service.
      </p>
    );
  }
  if (n !== 8728) {
    return (
      <p className="mt-1.5 text-xs text-slate-400">
        If a provider (e.g. MikroTicket) gives a <strong>reachable IP and TCP port</strong> that
        forwards to RouterOS API, use them here. The router may still use 8728 on the LAN; your
        billing server only connects to this public/relay endpoint.
      </p>
    );
  }
  return null;
}

function routerEndpointLabel(r) {
  if (!r?.host) return '';
  if (r.transport === 'ssh') {
    const p = Number(r.sshPort) || 22;
    return `${r.host}:${p}`;
  }
  const p = Number(r.apiPort) || 8728;
  return `${r.host}:${p}`;
}

/** Single "connect" field for forms — omit default ports (8728 / 22). */
function connectDisplay(r) {
  if (!r?.host) return '';
  if (r.transport === 'ssh') {
    const p = Number(r.sshPort) || 22;
    return p === 22 ? r.host : `${r.host}:${p}`;
  }
  const p = Number(r.apiPort) || 8728;
  return p === 8728 ? r.host : `${r.host}:${p}`;
}

function hostnameFromViteApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (!raw || typeof raw !== 'string') return '';
  try {
    return new URL(raw.trim()).hostname;
  } catch {
    return '';
  }
}


export function RoutersPanel() {
  const [routers, setRouters] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [connMessage, setConnMessage] = useState('');
  const [connError, setConnError] = useState('');
  const [testing, setTesting] = useState(false);
  const [wgSyncing, setWgSyncing] = useState(false);
  const [billingChecklist, setBillingChecklist] = useState(null);
  const [billingChecklistErr, setBillingChecklistErr] = useState('');

  const [addComment, setAddComment] = useState('');
  const [addConnect, setAddConnect] = useState('');
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');
  const [addError, setAddError] = useState('');

  const [editComment, setEditComment] = useState('');
  const [editConnect, setEditConnect] = useState('');
  const [editTransport, setEditTransport] = useState('ssh');
  const [editSshUser, setEditSshUser] = useState('');
  const [editNewSshPass, setEditNewSshPass] = useState('');
  const [editUser, setEditUser] = useState('');
  const [editNewPass, setEditNewPass] = useState('');
  const [editDefaultPpp, setEditDefaultPpp] = useState('default');
  const [editExpiredPpp, setEditExpiredPpp] = useState('nonpayment');
  const [editSitePublicIp, setEditSitePublicIp] = useState('');
  const [editPortalSlug, setEditPortalSlug] = useState('');
  const [editSmsBrandName, setEditSmsBrandName] = useState('');
  const [editSmsSenderId, setEditSmsSenderId] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRouters = useCallback(async () => {
    setListError('');
    const list = await apiFetch('/api/routers');
    const arr = Array.isArray(list) ? list : [];
    setRouters(arr);
    return arr;
  }, []);

  useEffect(() => {
    loadRouters().catch((e) => setListError(e.message));
  }, [loadRouters]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/routers/billing-access-checklist')
      .then((d) => {
        if (!cancelled) setBillingChecklist(d);
      })
      .catch((e) => {
        if (!cancelled) setBillingChecklistErr(e.message || 'Could not load checklist');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = routers.find((r) => r._id === selectedId);

  useEffect(() => {
    if (!selected) {
      setEditComment('');
      setEditConnect('');
      setEditTransport('ssh');
      setEditSshUser('');
      setEditNewSshPass('');
      setEditUser('');
      setEditNewPass('');
      setEditDefaultPpp('default');
      setEditExpiredPpp('nonpayment');
      setEditSitePublicIp('');
      setEditPortalSlug('');
      setEditSmsBrandName('');
      setEditSmsSenderId('');
      return;
    }
    setEditComment(
      selected.comment != null && String(selected.comment).trim()
        ? String(selected.comment).trim()
        : selected.name || ''
    );
    setEditConnect(connectDisplay(selected));
    setEditTransport(selected.transport === 'ssh' ? 'ssh' : 'api');
    setEditSshUser(selected.sshUser || '');
    setEditNewSshPass('');
    setEditUser(selected.apiUser || '');
    setEditNewPass('');
    setEditDefaultPpp(selected.defaultPppProfile || 'default');
    setEditExpiredPpp(selected.expiredPppProfile || 'nonpayment');
    setEditSitePublicIp(selected.sitePublicIp || '');
    setEditPortalSlug(selected.portalSlug || '');
    setEditSmsBrandName(selected.smsBrandName != null ? String(selected.smsBrandName) : '');
    setEditSmsSenderId(selected.smsSenderId != null ? String(selected.smsSenderId) : '');
    setConnMessage('');
    setConnError('');
    setSaveError('');
  }, [selected]);

  useEffect(() => {
    if (routers.length && !selectedId) {
      setSelectedId(routers[0]._id);
    }
    if (selectedId && !routers.some((r) => r._id === selectedId)) {
      setSelectedId(routers[0]?._id ?? '');
    }
  }, [routers, selectedId]);

  async function addRouter(e) {
    e.preventDefault();
    setAddError('');
    setLoading(true);
    try {
      const created = await apiFetch('/api/routers', {
        method: 'POST',
        body: JSON.stringify({
          ...(addComment.trim() ? { comment: addComment.trim() } : {}),
          host: addConnect.trim(),
          transport: 'ssh',
          apiUser: addUser.trim(),
          apiPassword: addPass,
        }),
      });
      setAddComment('');
      setAddConnect('');
      setAddUser('');
      setAddPass('');
      await loadRouters();
      const newId = created.id ?? created._id;
      if (newId) setSelectedId(String(newId));
    } catch (err) {
      setAddError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    if (!selectedId) return;
    setConnError('');
    setConnMessage('');
    setTesting(true);
    try {
      const r = await apiFetch(`/api/routers/${selectedId}/mikrotik/ping`);
      let msg = r.message || 'Connected';
      if (r.walledGarden?.ok) {
        const n =
          (r.walledGarden.addedHosts?.length || 0) + (r.walledGarden.addedIps?.length || 0);
        msg += ` Hotspot walled garden updated (${n} allow rule(s) for payments before login).`;
      } else if (r.walledGarden && !r.walledGarden.ok && r.walledGarden.error) {
        setConnError(
          `Connected, but walled garden sync failed (guests may not reach checkout until this is fixed): ${r.walledGarden.error}`
        );
      }
      setConnMessage(msg);
    } catch (e) {
      setConnError(e.message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  }

  async function syncWalledGardenOnly() {
    if (!selectedId) return;
    setConnError('');
    setConnMessage('');
    setWgSyncing(true);
    try {
      const r = await apiFetch(`/api/routers/${selectedId}/mikrotik/walled-garden/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const n = (r.addedHosts?.length || 0) + (r.addedIps?.length || 0);
      setConnMessage(
        `Walled garden synced: ${n} allow rule(s) added (${r.removed ?? 0} old QareFi rule(s) removed).`
      );
    } catch (e) {
      setConnError(e.message || 'Walled garden sync failed');
    } finally {
      setWgSyncing(false);
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
        sshUser: editSshUser.trim(),
        apiUser: editUser,
        defaultPppProfile: editDefaultPpp,
        expiredPppProfile: editExpiredPpp,
        sitePublicIp: editSitePublicIp.trim(),
        portalSlug: editPortalSlug.trim().toLowerCase(),
        smsBrandName: editSmsBrandName.trim(),
        smsSenderId: editSmsSenderId.trim(),
      };
      if (editNewPass.trim()) body.apiPassword = editNewPass;
      if (editNewSshPass.trim()) body.sshPassword = editNewSshPass;
      await apiFetch(`/api/routers/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditNewPass('');
      setEditNewSshPass('');
      await loadRouters();
      setConnMessage('');
      setConnError('');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Routers</h2>
        <p className="mt-2 text-sm text-slate-400">
          Add a router with the <strong>MikroTicket</strong> (or other) <strong>SSH</strong> details:
          address, login, and password. Default port is <strong>22</strong>; use{' '}
          <strong className="font-mono">host:port</strong> if they give a custom SSH port. Switch to
          RouterOS API under <strong>Advanced</strong> if you connect on <strong>8728</strong> instead.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          After a successful <strong>Test connection</strong>, the server updates MikroTik{' '}
          <strong>IP → Hotspot → Walled garden</strong> with <span className="font-mono">QareFi:</span>{' '}
          entries so guests can reach your pay page and billing API <strong>before</strong> hotspot login.
          Set env <span className="font-mono">PUBLIC_APP_URL</span> to your real customer HTTPS origin.
          Optional: <span className="font-mono">WALLED_GARDEN_EXTRA_HOSTS</span> (comma-separated),{' '}
          <span className="font-mono">SYNC_WALLED_GARDEN_ON_PING=false</span> to skip auto-sync.
        </p>
      </div>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-950/15 p-5">
        <h3 className="text-sm font-semibold text-amber-100">PPPoE renew / payment page (firewall)</h3>
        <p className="mt-2 text-sm text-amber-100/90">
          <strong>Hotspot walled garden does not apply to PPPoE.</strong> Subscribers on your{' '}
          <strong>expired PPP profile</strong> must be allowed to reach the billing site and payment
          APIs over <strong className="font-mono">HTTPS (443)</strong> (and usually <strong>DNS</strong>).
          Add firewall filter / address-list rules on the MikroTik for those clients before any rule that
          blocks them.
        </p>
        {billingChecklistErr && (
          <p className="mt-2 text-sm text-red-300">{billingChecklistErr}</p>
        )}
        {billingChecklist && (
          <>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-amber-200/80">
              Hostnames from server config (allow TCP 443)
            </p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-amber-50/95">
              {[...(billingChecklist.hosts || []), ...(billingChecklist.ips || [])].map((h) => (
                <li key={h} className="break-all">
                  {h}
                </li>
              ))}
            </ul>
            {(() => {
              const apiHost = hostnameFromViteApiBase();
              const listed = new Set([
                ...(billingChecklist.hosts || []),
                ...(billingChecklist.ips || []),
              ]);
              if (!apiHost || listed.has(apiHost)) return null;
              return (
                <p className="mt-3 rounded-lg border border-amber-400/40 bg-slate-950/40 px-3 py-2 text-xs text-amber-100">
                  This admin UI calls the API at <span className="font-mono">{apiHost}</span> but that
                  host is <strong>not</strong> in the list above. Add it to server env{' '}
                  <span className="font-mono">WALLED_GARDEN_EXTRA_HOSTS</span> on Render (comma-separated),
                  redeploy the API, then allow the same hostname on the router for PPPoE clients.
                </p>
              );
            })()}
            <ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-amber-100/85">
              {(billingChecklist.tips || []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-900/30"
              onClick={() => {
                const lines = [
                  ...(billingChecklist.hosts || []),
                  ...(billingChecklist.ips || []),
                ].join('\n');
                navigator.clipboard.writeText(lines).catch(() => {});
              }}
            >
              Copy host list
            </button>
          </>
        )}
      </section>

      {listError && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {listError}
        </p>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="font-medium text-white">Add router</h3>
        <p className="mt-1 text-xs text-slate-500">
          <strong>Comment</strong> is the router name everywhere (lists, customer portal). If you
          skip it, the hostname is used. Add <span className="font-mono">:port</span> when SSH is not
          on port 22.
        </p>
        <form onSubmit={addRouter} className="mt-4 max-w-md space-y-4">
          <label className="block text-sm text-slate-300">
            Comment (router name)
            <input
              value={addComment}
              onChange={(e) => setAddComment(e.target.value)}
              placeholder="e.g. East Legon POP"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Connect to
            <input
              required
              value={addConnect}
              onChange={(e) => setAddConnect(e.target.value)}
              placeholder="host or host:port — not “ssh … -p” (use 52.x.x.x:10864)"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Login
            <input
              required
              autoComplete="off"
              value={addUser}
              onChange={(e) => setAddUser(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={addPass}
              onChange={(e) => setAddPass(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          {addError && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {addError}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Add router'}
          </button>
        </form>
      </section>

      {routers.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="font-medium text-white">Saved routers — connect, then use Hotspot / PPPoE</h3>
          <p className="mt-1 text-xs text-slate-500">
            Pick a router, test the connection (SSH by default, or API if you switched it), then use
            Hotspot / PPPoE.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-300">
              Active router
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                {routers.map((r) => (
                  <option key={r._id} value={r._id}>
                    {routerLabel(r)} — {routerEndpointLabel(r)} ({r.transport === 'ssh' ? 'SSH' : 'API'})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={testing || !selectedId}
              onClick={testConnection}
              className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-950/70 disabled:opacity-50"
            >
              {testing ? 'Connecting…' : 'Test connection'}
            </button>
            <button
              type="button"
              disabled={wgSyncing || testing || !selectedId}
              onClick={syncWalledGardenOnly}
              className="rounded-lg border border-slate-600 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {wgSyncing ? 'Syncing walled garden…' : 'Sync walled garden only'}
            </button>
          </div>

          {connMessage && <p className="mt-3 text-sm text-emerald-400">{connMessage}</p>}
          {connError && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-amber-200">{connError}</p>
          )}

          {selected && (
            <form onSubmit={saveEdits} className="mt-8 space-y-4 border-t border-slate-800 pt-6">
              <h4 className="text-sm font-medium text-slate-200">Edit router</h4>
              <label className="block text-sm text-slate-300">
                Connect to
                <input
                  required
                  value={editConnect}
                  onChange={(e) => setEditConnect(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Comment (router name)
                <input
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                  placeholder="Shown in lists and customer portal; empty uses connect hostname"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Login
                <input
                  required
                  value={editUser}
                  onChange={(e) => setEditUser(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-300">
                New password (leave blank to keep)
                <input
                  type="password"
                  value={editNewPass}
                  onChange={(e) => setEditNewPass(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>

              <details className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-300">
                  Advanced — connection type, PPP, customer portal
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="block text-sm text-slate-300">
                    Connection type
                    <select
                      value={editTransport}
                      onChange={(e) => setEditTransport(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                    >
                      <option value="ssh">SSH — MikroTicket-style (default port 22, or add :port)</option>
                      <option value="api">RouterOS API (default port 8728, or add :port)</option>
                    </select>
                  </label>
                  {editTransport === 'api' ? (
                    <ApiPortHint
                      port={
                        (() => {
                          const m = String(editConnect).match(/:(\d{1,5})$/);
                          return m ? Number(m[1]) : 8728;
                        })()
                      }
                    />
                  ) : (
                    <label className="block text-sm text-slate-300">
                      SSH user override (optional)
                      <input
                        value={editSshUser}
                        onChange={(e) => setEditSshUser(e.target.value)}
                        placeholder="Empty = login above"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                      />
                    </label>
                  )}
                  {editTransport === 'ssh' && (
                    <label className="block text-sm text-slate-300">
                      New SSH-only password (optional)
                      <input
                        type="password"
                        value={editNewSshPass}
                        onChange={(e) => setEditNewSshPass(e.target.value)}
                        autoComplete="new-password"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                      />
                    </label>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm text-slate-300">
                      Default active PPP profile
                      <input
                        value={editDefaultPpp}
                        onChange={(e) => setEditDefaultPpp(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </label>
                    <label className="block text-sm text-slate-300">
                      Default expired profile (PPPoE — e.g. captive / renew page)
                      <input
                        value={editExpiredPpp}
                        onChange={(e) => setEditExpiredPpp(e.target.value)}
                        placeholder="nonpayment"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                      <span className="mt-1 block text-xs text-slate-500">
                        Must match a <strong className="text-slate-400">PPP profile</strong> name on
                        MikroTik. When <code className="text-slate-400">paidUntil</code> passes, QareFi
                        syncs this profile to the secret.
                      </span>
                    </label>
                  </div>
                  <label className="block text-sm text-slate-300">
                    Customer WAN IPv4 (auto-detect pay page)
                    <input
                      value={editSitePublicIp}
                      onChange={(e) => setEditSitePublicIp(e.target.value)}
                      placeholder="Empty = clear"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    Portal slug (?r=)
                    <input
                      value={editPortalSlug}
                      onChange={(e) =>
                        setEditPortalSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                      }
                      placeholder="Empty = clear"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-medium text-slate-400">SMS for this site</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Payment SMS and broadcasts that target this router use the business name in{' '}
                      <code className="text-slate-400">{'{{brand}}'}</code>. Optional sender ID must be
                      registered in Arkesel; leave blank to use the global sender.
                    </p>
                    <label className="mt-3 block text-sm text-slate-300">
                      SMS business name (<code className="text-violet-300">{'{{brand}}'}</code>)
                      <input
                        value={editSmsBrandName}
                        onChange={(e) => setEditSmsBrandName(e.target.value)}
                        placeholder="Empty = use global brand from env"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="mt-3 block text-sm text-slate-300">
                      Arkesel sender ID (optional)
                      <input
                        value={editSmsSenderId}
                        onChange={(e) => setEditSmsSenderId(e.target.value)}
                        placeholder="Empty = ARKESEL_SENDER_ID"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                      />
                    </label>
                  </div>
                  {selected?.portalSlug && typeof window !== 'undefined' && (
                    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-400">
                      <p className="font-medium text-slate-300">Customer pay links</p>
                      <p className="mt-2 break-all font-mono text-emerald-400/90">
                        {window.location.origin}/portal/hotspot?r={selected.portalSlug}
                      </p>
                      <p className="mt-2 break-all font-mono text-emerald-400/90">
                        {window.location.origin}/portal/renew?r={selected.portalSlug}
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-slate-300 underline"
                        onClick={() => {
                          const t = `${window.location.origin}/portal/hotspot?r=${selected.portalSlug}`;
                          navigator.clipboard.writeText(t);
                        }}
                      >
                        Copy hotspot link
                      </button>
                    </div>
                  )}
                </div>
              </details>

              {saveError && (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {saveError}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

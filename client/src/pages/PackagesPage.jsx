import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { routerDisplayName } from '../utils/routerDisplayName.js';

const KIND_OPTIONS = [
  {
    kind: 'hotspot',
    title: 'Hotspot',
    blurb: 'Vouchers for the captive portal buy page.',
  },
  {
    kind: 'pppoe',
    title: 'PPPoE',
    blurb: 'Subscriptions for PPPoE accounts and renewals.',
  },
  {
    kind: 'remote_access',
    title: 'Remote access',
    blurb: 'Plans for remote access subscriptions.',
    needsModule: true,
  },
];

function profileNameFromPackageName(name) {
  return (
    String(name || 'hotspot')
      .trim()
      .replace(/^pkg-/i, '')
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._@-]/g, '')
      .slice(0, 48) || 'hotspot'
  );
}

function emptyFormFor(kind) {
  if (kind === 'hotspot') {
    return {
      name: '',
      kind,
      priceGhs: '',
      usersPerTicket: '1',
      speedUpMbps: '',
      speedDownMbps: '',
      ticketDurationType: 'elapsed',
      elapsedDays: '0',
      elapsedHours: '0',
      elapsedMinutes: '0',
      pausedDays: '0',
      pausedHours: '0',
      pausedMinutes: '0',
      dataLimitMb: '',
      codeType: 'pin',
      pinLength: '6',
      activeProfile: 'default',
      syncRouterId: '',
      description: '',
      isActive: true,
    };
  }
  return {
    name: '',
    kind,
    priceGhs: '',
    durationAmount: '30',
    durationUnit: 'day',
    activeProfile: 'default',
    expiredProfile: '',
    description: '',
    isActive: true,
  };
}

function dhmsToSeconds(days, hours, minutes) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return d * 86400 + h * 3600 + m * 60;
}

function secondsToDhms(total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  return {
    days: String(Math.floor(n / 86400)),
    hours: String(Math.floor((n % 86400) / 3600)),
    minutes: String(Math.floor((n % 3600) / 60)),
  };
}

function packageToForm(row) {
  const kind = row.kind || 'hotspot';
  const base = emptyFormFor(kind);
  base.name = row.name || '';
  base.priceGhs =
    row.priceCents != null && Number.isFinite(Number(row.priceCents))
      ? String(Number(row.priceCents) / 100)
      : '';
  base.description = row.description || '';
  base.isActive = row.isActive !== false;
  base.activeProfile = row.activeProfile || (kind === 'remote_access' ? 'n/a' : 'default');

  if (kind === 'hotspot') {
    const type = row.ticketDurationType === 'paused' ? 'paused' : 'elapsed';
    const elapsed = secondsToDhms(row.elapsedSeconds);
    const paused = secondsToDhms(row.pausedSeconds ?? row.timeLimitSeconds);
    base.ticketDurationType = type;
    base.elapsedDays = elapsed.days;
    base.elapsedHours = elapsed.hours;
    base.elapsedMinutes = elapsed.minutes;
    base.pausedDays = paused.days;
    base.pausedHours = paused.hours;
    base.pausedMinutes = paused.minutes;
    base.usersPerTicket = String(row.usersPerTicket ?? 1);
    base.speedUpMbps = row.speedUpMbps != null ? String(row.speedUpMbps) : '';
    base.speedDownMbps = row.speedDownMbps != null ? String(row.speedDownMbps) : '';
    base.dataLimitMb =
      row.dataLimitBytes != null && Number(row.dataLimitBytes) > 0
        ? String(Math.round(Number(row.dataLimitBytes) / 1048576))
        : '';
    base.codeType = row.codeType === 'user_pass' ? 'user_pass' : 'pin';
    base.pinLength = String(row.pinLength || 6);
  } else {
    base.durationAmount = String(row.durationAmount ?? row.durationDays ?? 30);
    base.durationUnit = row.durationUnit || 'day';
    if (kind === 'pppoe') {
      base.expiredProfile = row.expiredProfile || '';
    }
  }
  return base;
}

function formatSeconds(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : '0m';
}

function formatDataLimit(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1)} MB`;
  return `${(n / 1073741824).toFixed(n % 1073741824 === 0 ? 0 : 1)} GB`;
}

function fieldClass() {
  return 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40';
}

function DurationPicker({ label, hint, days, hours, minutes, onChange }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-300">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[
          { key: 'days', label: 'Days', value: days },
          { key: 'hours', label: 'Hours', value: hours },
          { key: 'minutes', label: 'Minutes', value: minutes },
        ].map((u) => (
          <label key={u.key} className="block text-xs text-slate-400">
            {u.label}
            <input
              type="number"
              min={0}
              value={u.value}
              onChange={(e) => onChange(u.key, e.target.value)}
              className={fieldClass()}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function PackagesPage() {
  const [list, setList] = useState([]);
  const [routers, setRouters] = useState([]);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [selectedKind, setSelectedKind] = useState(null);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [hotspotTab, setHotspotTab] = useState('simple');
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [smsModal, setSmsModal] = useState(null);
  const [smsDraft, setSmsDraft] = useState('');
  const [smsSaving, setSmsSaving] = useState(false);
  const [canRemoteAccess, setCanRemoteAccess] = useState(false);

  const load = useCallback(() => {
    setErr('');
    return Promise.all([
      apiFetch('/api/packages?all=1'),
      apiFetch('/api/routers').catch(() => []),
    ])
      .then(([pkgs, r]) => {
        setList(pkgs);
        setRouters(Array.isArray(r) ? r : []);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    apiFetch('/api/auth/me')
      .then((m) => {
        const isSuper = m?.admin?.role === 'super_admin';
        setCanRemoteAccess(isSuper || Boolean(m?.modules?.remoteAccess));
      })
      .catch(() => setCanRemoteAccess(false));
  }, [load]);

  const kindChoices = useMemo(
    () => KIND_OPTIONS.filter((k) => !k.needsModule || canRemoteAccess),
    [canRemoteAccess]
  );

  /* Default to Hotspot so create/list/actions are visible immediately */
  useEffect(() => {
    if (selectedKind) return;
    if (!kindChoices.length) return;
    selectKind(kindChoices[0].kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, [kindChoices, selectedKind, routers]);

  function selectKind(kind) {
    setSelectedKind(kind);
    setEditingId(null);
    const next = emptyFormFor(kind);
    if (kind === 'hotspot') {
      next.syncRouterId = routers[0]?._id ? String(routers[0]._id) : '';
    }
    setForm(next);
    setHotspotTab('simple');
    setErr('');
    setInfo('');
  }

  function startCreate() {
    if (!selectedKind) return;
    setEditingId(null);
    const next = emptyFormFor(selectedKind);
    if (selectedKind === 'hotspot') {
      next.syncRouterId = form?.syncRouterId || (routers[0]?._id ? String(routers[0]._id) : '');
    }
    setForm(next);
    setHotspotTab('simple');
    setErr('');
    setInfo('');
  }

  function startEdit(row) {
    setSelectedKind(row.kind);
    setEditingId(row._id);
    const next = packageToForm(row);
    if (row.kind === 'hotspot') {
      next.syncRouterId = form?.syncRouterId || (routers[0]?._id ? String(routers[0]._id) : '');
    }
    setForm(next);
    setHotspotTab('simple');
    setErr('');
    setInfo('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildPayload() {
    if (!form || !selectedKind) return null;
    const priceGhs = Number(form.priceGhs);
    const payload = {
      name: form.name.trim(),
      kind: selectedKind,
      priceCents: Number.isFinite(priceGhs) && priceGhs >= 0 ? Math.round(priceGhs * 100) : 0,
      currency: 'GHS',
      description: form.description.trim() || null,
      isActive: Boolean(form.isActive),
    };

    if (selectedKind === 'hotspot') {
      const type = form.ticketDurationType === 'paused' ? 'paused' : 'elapsed';
      const elapsed = dhmsToSeconds(form.elapsedDays, form.elapsedHours, form.elapsedMinutes);
      const paused = dhmsToSeconds(form.pausedDays, form.pausedHours, form.pausedMinutes);
      if (type === 'elapsed' && elapsed <= 0) {
        throw new Error('Set elapsed time (days / hours / minutes).');
      }
      if (type === 'paused' && paused <= 0) {
        throw new Error('Set paused time (days / hours / minutes).');
      }
      if (!form.syncRouterId) {
        throw new Error('Select a router to sync this package as a hotspot user profile.');
      }
      const users = Math.max(1, Math.floor(Number(form.usersPerTicket) || 1));
      const up = Number(form.speedUpMbps);
      const down = Number(form.speedDownMbps);
      const mb = Number(form.dataLimitMb);
      const pinLength = Math.min(10, Math.max(4, Math.floor(Number(form.pinLength) || 6)));

      payload.activeProfile = profileNameFromPackageName(form.name);
      payload.syncRouterId = form.syncRouterId;
      payload.usersPerTicket = users;
      payload.ticketDurationType = type;
      payload.codeType = form.codeType === 'user_pass' ? 'user_pass' : 'pin';
      payload.pinLength = pinLength;
      payload.speedUpMbps = Number.isFinite(up) && up > 0 ? up : null;
      payload.speedDownMbps = Number.isFinite(down) && down > 0 ? down : null;
      payload.dataLimitBytes = Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1048576) : null;
      if (type === 'elapsed') {
        payload.elapsedSeconds = elapsed;
        payload.pausedSeconds = null;
        payload.timeLimitSeconds = null;
        payload.durationAmount = Math.max(1, Math.round(elapsed / 60));
        payload.durationUnit = 'minute';
      } else {
        payload.pausedSeconds = paused;
        payload.timeLimitSeconds = paused;
        payload.elapsedSeconds = null;
      }
    } else if (selectedKind === 'pppoe') {
      payload.durationAmount = Number(form.durationAmount) || 1;
      payload.durationUnit = form.durationUnit || 'day';
      payload.activeProfile = form.activeProfile.trim() || 'default';
      payload.expiredProfile = form.expiredProfile.trim() || null;
    } else {
      payload.durationAmount = Number(form.durationAmount) || 1;
      payload.durationUnit = form.durationUnit || 'day';
      payload.activeProfile = 'n/a';
    }
    return payload;
  }

  async function savePackage(e) {
    e.preventDefault();
    if (!form || !selectedKind) return;
    setSaving(true);
    setErr('');
    setInfo('');
    try {
      const payload = buildPayload();
      let saved;
      if (editingId) {
        saved = await apiFetch(`/api/packages/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        saved = await apiFetch('/api/packages', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      if (saved?.sync?.profileName) {
        setInfo(
          `Package saved. Profile “${saved.sync.profileName}” ${
            saved.sync.created ? 'created' : 'updated'
          } on ${saved.sync.routerName || 'router'}. Rate limit on router: ${
            saved.sync.rateLimit || 'unlimited'
          }.${saved.sync.onLogin ? ' Login script installed.' : ''}`
        );
      }
      const keepRouter = form.syncRouterId;
      setEditingId(null);
      const next = emptyFormFor(selectedKind);
      if (selectedKind === 'hotspot') next.syncRouterId = keepRouter || '';
      setForm(next);
      setHotspotTab('simple');
      await load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  }

  async function syncPackageToRouter(row, routerId) {
    const rid = routerId || form?.syncRouterId || (routers[0]?._id ? String(routers[0]._id) : '');
    if (!rid) {
      setErr('Select a router first.');
      return;
    }
    setSyncingId(row._id);
    setErr('');
    setInfo('');
    try {
      const sync = await apiFetch(`/api/packages/${row._id}/sync-to-router`, {
        method: 'POST',
        body: JSON.stringify({ routerId: rid }),
      });
      setInfo(
        `Synced “${sync.packageName}” → profile “${sync.profileName}” on ${sync.routerName}. Rate limit on router: ${
          sync.rateLimit || 'unlimited'
        }.${sync.onLogin ? ' Login script installed.' : ''}`
      );
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSyncingId(null);
    }
  }

  async function toggleActive(row) {
    try {
      await apiFetch(`/api/packages/${row._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function deletePackage(row) {
    const ok = window.confirm(
      `Delete package “${row.name}”? Existing vouchers/subscriptions keep their limits, but this plan can no longer be sold or generated.`
    );
    if (!ok) return;
    setDeletingId(row._id);
    setErr('');
    try {
      await apiFetch(`/api/packages/${row._id}`, { method: 'DELETE' });
      if (editingId === row._id) {
        setEditingId(null);
        setForm(emptyFormFor(row.kind));
      }
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  function openRenewalSmsModal(row) {
    setSmsModal({ _id: row._id, name: row.name, kind: row.kind });
    setSmsDraft(String(row.renewalSmsBody ?? ''));
  }

  async function saveRenewalSms() {
    if (!smsModal) return;
    setSmsSaving(true);
    setErr('');
    try {
      await apiFetch(`/api/packages/${smsModal._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ renewalSmsBody: smsDraft }),
      });
      setSmsModal(null);
      setSmsDraft('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSmsSaving(false);
    }
  }

  const filtered = useMemo(() => {
    if (!selectedKind) return [];
    return list.filter((p) => p.kind === selectedKind);
  }, [list, selectedKind]);

  const selectedMeta = KIND_OPTIONS.find((k) => k.kind === selectedKind);
  const durationType = form?.ticketDurationType === 'paused' ? 'paused' : 'elapsed';
  const isEditing = Boolean(editingId);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Packages</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select a type to create, edit, or delete plans. Each package is an internet plan used for
          vouchers, PPPoE, or remote access.
        </p>
      </div>

      {err && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      )}
      {info && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {info}
        </p>
      )}

      {smsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="renewal-sms-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <h3 id="renewal-sms-title" className="text-base font-semibold text-white">
              Renewal SMS — {smsModal.name}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Sent after Hubtel renewal, admin renew, or auto-renew when a phone is on file. Leave empty
              to use the built-in default. Placeholders:{' '}
              <span className="font-mono text-slate-400">
                {'{{brand}}'} {'{{name}}'} {'{{package}}'} {'{{paidUntil}}'} {'{{secret}}'}{' '}
                {'{{phone}}'}
              </span>
              .
            </p>
            <textarea
              value={smsDraft}
              onChange={(e) => setSmsDraft(e.target.value)}
              rows={6}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSmsModal(null);
                  setSmsDraft('');
                }}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={smsSaving}
                onClick={saveRenewalSms}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {smsSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-sm font-medium text-slate-300">What do you want to create?</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kindChoices.map((opt) => {
            const count = list.filter((p) => p.kind === opt.kind).length;
            const active = selectedKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                onClick={() => selectKind(opt.kind)}
                className={`rounded-xl border px-4 py-4 text-left transition ${
                  active
                    ? 'border-indigo-500/60 bg-indigo-950/40 ring-1 ring-indigo-500/40'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{opt.title}</span>
                  <span className="text-xs text-slate-500">{count}</span>
                </span>
                <span className="mt-1 block text-xs text-slate-400">{opt.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      {!selectedKind || !form ? (
        <p className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
          Select Hotspot, PPPoE, or Remote access above to continue.
        </p>
      ) : (
        <>
          <form
            onSubmit={savePackage}
            className="max-w-2xl space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {isEditing ? `Edit ${selectedMeta?.title} package` : `New ${selectedMeta?.title} package`}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">{selectedMeta?.blurb}</p>
              </div>
              {isEditing ? (
                <button
                  type="button"
                  onClick={startCreate}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>

            {selectedKind === 'hotspot' ? (
              <>
                <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1">
                  {[
                    { id: 'simple', label: 'Simple' },
                    { id: 'advanced', label: 'Advanced' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setHotspotTab(t.id)}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                        hotspotTab === t.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {hotspotTab === 'simple' ? (
                  <div className="space-y-4">
                    <label className="block text-sm text-slate-300">
                      Name
                      <input
                        required
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. 10MIN"
                        className={fieldClass()}
                      />
                      <span className="mt-1 block text-xs text-slate-500">
                        Becomes MikroTik user profile “{profileNameFromPackageName(form.name)}”
                      </span>
                    </label>

                    <label className="block text-sm text-slate-300">
                      Sync to router
                      <select
                        required
                        value={form.syncRouterId || ''}
                        onChange={(e) => setForm((f) => ({ ...f, syncRouterId: e.target.value }))}
                        className={fieldClass()}
                      >
                        <option value="">Select router…</option>
                        {routers.map((r) => (
                          <option key={r._id} value={r._id}>
                            {routerDisplayName(r)} ({r.host})
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs text-slate-500">
                        Saves the plan in QareFi and creates/updates it under IP → Hotspot → User
                        Profiles on this router.
                      </span>
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm text-slate-300">
                        Price (GHS)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          required
                          value={form.priceGhs}
                          onChange={(e) => setForm((f) => ({ ...f, priceGhs: e.target.value }))}
                          placeholder="0.00"
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm text-slate-300">
                        Users per ticket
                        <input
                          type="number"
                          min={1}
                          required
                          value={form.usersPerTicket}
                          onChange={(e) => setForm((f) => ({ ...f, usersPerTicket: e.target.value }))}
                          className={fieldClass()}
                        />
                        <span className="mt-1 block text-xs text-slate-500">
                          Concurrent devices allowed on one code.
                        </span>
                      </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm text-slate-300">
                        Speed down (Mbps)
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={form.speedDownMbps}
                          onChange={(e) => setForm((f) => ({ ...f, speedDownMbps: e.target.value }))}
                          placeholder="e.g. 10"
                          className={fieldClass()}
                        />
                        <span className="mt-1 block text-xs text-slate-500">Download to the device.</span>
                      </label>
                      <label className="block text-sm text-slate-300">
                        Speed up (Mbps)
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={form.speedUpMbps}
                          onChange={(e) => setForm((f) => ({ ...f, speedUpMbps: e.target.value }))}
                          placeholder="e.g. 5"
                          className={fieldClass()}
                        />
                        <span className="mt-1 block text-xs text-slate-500">Upload from the device.</span>
                      </label>
                    </div>

                    <label className="block text-sm text-slate-300">
                      Type of ticket duration
                      <select
                        value={form.ticketDurationType}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, ticketDurationType: e.target.value }))
                        }
                        className={fieldClass()}
                      >
                        <option value="elapsed">Elapsed time</option>
                        <option value="paused">Paused time</option>
                      </select>
                    </label>

                    {durationType === 'elapsed' ? (
                      <DurationPicker
                        label="Elapsed time"
                        hint="Starts at the first login. The router disconnects the device when this time is up, even if they stay online."
                        days={form.elapsedDays}
                        hours={form.elapsedHours}
                        minutes={form.elapsedMinutes}
                        onChange={(key, value) =>
                          setForm((f) => ({
                            ...f,
                            [`elapsed${key[0].toUpperCase()}${key.slice(1)}`]: value,
                          }))
                        }
                      />
                    ) : (
                      <DurationPicker
                        label="Paused time"
                        hint="Counts only while the device is connected. The router disconnects it when that online time is used up."
                        days={form.pausedDays}
                        hours={form.pausedHours}
                        minutes={form.pausedMinutes}
                        onChange={(key, value) =>
                          setForm((f) => ({
                            ...f,
                            [`paused${key[0].toUpperCase()}${key.slice(1)}`]: value,
                          }))
                        }
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <label className="block text-sm text-slate-300">
                      Total data limit (MB)
                      <input
                        type="number"
                        min={0}
                        placeholder="Unlimited"
                        value={form.dataLimitMb}
                        onChange={(e) => setForm((f) => ({ ...f, dataLimitMb: e.target.value }))}
                        className={fieldClass()}
                      />
                      <span className="mt-1 block text-xs text-slate-500">
                        Leave empty for unlimited volume.
                      </span>
                    </label>

                    <fieldset>
                      <legend className="text-sm font-medium text-slate-300">Type of code</legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {[
                          {
                            id: 'pin',
                            title: 'PIN',
                            blurb: 'Same code for username and password.',
                          },
                          {
                            id: 'user_pass',
                            title: 'User / password',
                            blurb: 'Separate username and password.',
                          },
                        ].map((opt) => (
                          <label
                            key={opt.id}
                            className={`cursor-pointer rounded-lg border px-3 py-3 ${
                              form.codeType === opt.id
                                ? 'border-indigo-500/60 bg-indigo-950/30'
                                : 'border-slate-800 bg-slate-950/40'
                            }`}
                          >
                            <input
                              type="radio"
                              name="codeType"
                              className="sr-only"
                              checked={form.codeType === opt.id}
                              onChange={() => setForm((f) => ({ ...f, codeType: opt.id }))}
                            />
                            <span className="block text-sm font-medium text-white">{opt.title}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{opt.blurb}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <label className="block text-sm text-slate-300">
                      PIN / code length
                      <select
                        value={form.pinLength}
                        onChange={(e) => setForm((f) => ({ ...f, pinLength: e.target.value }))}
                        className={fieldClass()}
                      >
                        {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>
                            {n} characters
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-slate-300">
                      Description <span className="font-normal text-slate-500">(optional)</span>
                      <input
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        className={fieldClass()}
                      />
                    </label>
                  </div>
                )}

                <label className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active (available for sale / generation)
                </label>
              </>
            ) : (
              <>
                <label className="block text-sm text-slate-300">
                  Name
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={
                      selectedKind === 'pppoe' ? 'e.g. Monthly home' : 'e.g. Monthly remote'
                    }
                    className={fieldClass()}
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm text-slate-300">
                    Price (GHS)
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={form.priceGhs}
                      onChange={(e) => setForm((f) => ({ ...f, priceGhs: e.target.value }))}
                      placeholder="0.00"
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm text-slate-300">
                    {selectedKind === 'pppoe' ? 'Billing period' : 'Valid for'}
                    <span className="mt-1 flex gap-2">
                      <input
                        type="number"
                        min={1}
                        required
                        value={form.durationAmount}
                        onChange={(e) => setForm((f) => ({ ...f, durationAmount: e.target.value }))}
                        className={`${fieldClass()} w-24 shrink-0`}
                      />
                      <select
                        value={form.durationUnit}
                        onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}
                        className={fieldClass()}
                      >
                        <option value="minute">minutes</option>
                        <option value="hour">hours</option>
                        <option value="day">days</option>
                        <option value="month">months</option>
                      </select>
                    </span>
                  </label>
                </div>

                {selectedKind === 'pppoe' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm text-slate-300">
                      Active profile
                      <input
                        required
                        value={form.activeProfile}
                        onChange={(e) => setForm((f) => ({ ...f, activeProfile: e.target.value }))}
                        className={`${fieldClass()} font-mono`}
                      />
                    </label>
                    <label className="block text-sm text-slate-300">
                      Expired profile
                      <input
                        value={form.expiredProfile}
                        onChange={(e) => setForm((f) => ({ ...f, expiredProfile: e.target.value }))}
                        placeholder="nonpayment"
                        className={`${fieldClass()} font-mono`}
                      />
                    </label>
                  </div>
                )}

                <label className="block text-sm text-slate-300">
                  Description <span className="text-slate-500">(optional)</span>
                  <input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className={fieldClass()}
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  Active (available for sale / assignment)
                </label>
              </>
            )}

            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving
                ? 'Saving…'
                : isEditing
                  ? selectedKind === 'hotspot'
                    ? 'Save & sync to router'
                    : 'Save changes'
                  : selectedKind === 'hotspot'
                    ? `Add ${selectedMeta?.title} & sync`
                    : `Add ${selectedMeta?.title} package`}
            </button>
          </form>

          <section className="overflow-hidden rounded-xl border border-slate-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">{selectedMeta?.title} packages</h3>
              <span className="text-xs text-slate-500">
                {filtered.length} package{filtered.length === 1 ? '' : 's'}
              </span>
            </div>
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No {selectedMeta?.title.toLowerCase()} packages yet. Create one above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-slate-800/80 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Price</th>
                      {selectedKind === 'hotspot' ? (
                        <>
                          <th className="px-4 py-2.5">Speed</th>
                          <th className="px-4 py-2.5">Duration</th>
                          <th className="px-4 py-2.5">Users</th>
                          <th className="px-4 py-2.5">Code</th>
                        </>
                      ) : (
                        <>
                          <th className="px-4 py-2.5">Duration</th>
                          {selectedKind !== 'remote_access' ? (
                            <th className="px-4 py-2.5">Profile</th>
                          ) : null}
                          {selectedKind === 'pppoe' ? (
                            <th className="px-4 py-2.5">Expired</th>
                          ) : null}
                        </>
                      )}
                      <th className="px-4 py-2.5">SMS</th>
                      <th className="px-4 py-2.5">Active</th>
                      <th className="px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filtered.map((p) => (
                      <tr
                        key={p._id}
                        className={`text-slate-300 ${editingId === p._id ? 'bg-indigo-950/20' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">{p.name}</span>
                          {p.description ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {p.description}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {(Number(p.priceCents) / 100).toFixed(2)} {p.currency || 'GHS'}
                        </td>
                        {selectedKind === 'hotspot' ? (
                          <>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              ↓{p.speedDownMbps || '—'} / ↑{p.speedUpMbps || '—'} Mbps
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {p.ticketDurationType === 'paused' ? (
                                <span className="block">
                                  Paused {formatSeconds(p.pausedSeconds ?? p.timeLimitSeconds)}
                                </span>
                              ) : (
                                <span className="block">
                                  Elapsed {formatSeconds(p.elapsedSeconds)}
                                </span>
                              )}
                              {p.dataLimitBytes ? (
                                <span className="block">{formatDataLimit(p.dataLimitBytes)}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">{p.usersPerTicket ?? 1}</td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {p.codeType === 'user_pass' ? 'User/pass' : 'PIN'} ·{' '}
                              {p.pinLength || 6}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3">
                              {p.durationAmount ?? p.durationDays ?? '—'}{' '}
                              {p.durationUnit || (p.durationDays ? 'day' : '')}
                            </td>
                            {selectedKind !== 'remote_access' ? (
                              <td className="px-4 py-3 font-mono text-xs">
                                {p.activeProfile || '—'}
                              </td>
                            ) : null}
                            {selectedKind === 'pppoe' ? (
                              <td className="px-4 py-3 font-mono text-xs text-slate-400">
                                {p.expiredProfile || '—'}
                              </td>
                            ) : null}
                          </>
                        )}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openRenewalSmsModal(p)}
                            className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                          >
                            SMS
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleActive(p)}
                            className={`rounded-md px-2 py-1 text-xs ${
                              p.isActive
                                ? 'bg-emerald-950 text-emerald-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {p.isActive ? 'Yes' : 'No'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(p)}
                              className="rounded-md border border-indigo-500/50 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-950/50"
                            >
                              Edit
                            </button>
                            {selectedKind === 'hotspot' ? (
                              <button
                                type="button"
                                disabled={syncingId === p._id || !routers.length}
                                onClick={() =>
                                  syncPackageToRouter(
                                    p,
                                    form?.syncRouterId || String(routers[0]?._id || '')
                                  )
                                }
                                className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-950/40 disabled:opacity-50"
                              >
                                {syncingId === p._id ? '…' : 'Sync'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={deletingId === p._id}
                              onClick={() => deletePackage(p)}
                              className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                            >
                              {deletingId === p._id ? '…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

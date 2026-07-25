import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

const emptyForm = {
  name: '',
  kind: 'hotspot',
  priceCents: 0,
  currency: 'GHS',
  durationAmount: 1,
  durationUnit: 'day',
  activeProfile: 'default',
  expiredProfile: '',
  description: '',
  isActive: true,
};

export function PackagesPage() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [smsModal, setSmsModal] = useState(null);
  const [smsDraft, setSmsDraft] = useState('');
  const [smsSaving, setSmsSaving] = useState(false);

  const load = useCallback(() => {
    setErr('');
    return apiFetch('/api/packages?all=1')
      .then(setList)
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createPackage(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const base = {
        ...form,
        name: form.name.trim(),
        priceCents: Number(form.priceCents) || 0,
        durationAmount: Number(form.durationAmount) || 1,
        description: form.description.trim() || undefined,
      };
      if (form.kind !== 'remote_access') {
        base.activeProfile = form.activeProfile.trim() || 'default';
        base.expiredProfile = form.expiredProfile.trim() || undefined;
      } else {
        base.activeProfile = 'n/a';
      }
      await apiFetch('/api/packages', {
        method: 'POST',
        body: JSON.stringify(base),
      });
      setForm(emptyForm);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Packages</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hotspot, PPPoE, and remote access (non–PPPoE) billing templates.
        </p>
      </div>

      {err && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {err}
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
              Sent after Hubtel renewal, admin renew, or auto-renew when a phone is on file. Leave empty to use the
              built-in default for this package kind (saved defaults apply to new packages automatically).
              Placeholders:{' '}
              <span className="font-mono text-slate-400">
                {'{{brand}}'} {'{{name}}'} {'{{package}}'} {'{{paidUntil}}'} {'{{secret}}'} {'{{phone}}'}
              </span>
              . PPPoE lines use <span className="font-mono text-slate-400">secret</span>; remote access uses{' '}
              <span className="font-mono text-slate-400">phone</span>.
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

      <form
        onSubmit={createPackage}
        className="grid max-w-3xl gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:grid-cols-2"
      >
        <label className="block text-sm text-slate-300 sm:col-span-2">
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Kind
          <select
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="hotspot">Hotspot</option>
            <option value="pppoe">PPPoE</option>
            <option value="remote_access">Remote access</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            PPPoE → <strong className="text-slate-400">Users → PPPoE</strong>. Remote access →{' '}
            <strong className="text-slate-400">Users → Remote access</strong>. Hotspot → public buy page.
          </span>
        </label>
        <label className="block text-sm text-slate-300">
          Price (pesewas / cents)
          <input
            type="number"
            min={0}
            value={form.priceCents}
            onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Duration amount
          <input
            type="number"
            min={1}
            value={form.durationAmount}
            onChange={(e) => setForm((f) => ({ ...f, durationAmount: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Duration unit
          <select
            value={form.durationUnit}
            onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="minute">minute</option>
            <option value="hour">hour</option>
            <option value="day">day</option>
            <option value="month">month</option>
          </select>
        </label>
        {form.kind !== 'remote_access' && (
          <>
            <label className="block text-sm text-slate-300">
              Active profile (MikroTik)
              <input
                value={form.activeProfile}
                onChange={(e) => setForm((f) => ({ ...f, activeProfile: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Expired profile (optional — PPPoE; MikroTik profile when time runs out)
              <input
                value={form.expiredProfile}
                onChange={(e) => setForm((f) => ({ ...f, expiredProfile: e.target.value }))}
                placeholder="nonpayment"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Default on the router record is <span className="font-mono text-slate-400">nonpayment</span>{' '}
                if left empty here.
              </span>
            </label>
          </>
        )}
        <label className="block text-sm text-slate-300 sm:col-span-2">
          Description
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="pkg-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          <label htmlFor="pkg-active" className="text-sm text-slate-400">
            Active (visible on public portal when kind matches)
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 sm:col-span-2"
        >
          {saving ? 'Saving…' : 'Add package'}
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Profile</th>
              <th className="px-4 py-3">Renewal SMS</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {list.map((p) => (
              <tr key={p._id} className="text-slate-300">
                <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                <td className="px-4 py-3">{p.kind}</td>
                <td className="px-4 py-3">
                  {(Number(p.priceCents) / 100).toFixed(2)} {p.currency || 'GHS'}
                </td>
                <td className="px-4 py-3">
                  {p.durationAmount ?? p.durationDays ?? '—'} {p.durationUnit || (p.durationDays ? 'day' : '')}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {p.kind === 'remote_access' ? '—' : p.activeProfile}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openRenewalSmsModal(p)}
                    className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Edit
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
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No packages yet.</p>
        )}
      </div>
    </div>
  );
}

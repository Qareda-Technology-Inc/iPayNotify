import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

const emptyTemplate = {
  name: '',
  category: 'custom',
  body: '',
  description: '',
  isActive: true,
};

/** @typedef {'audiences' | 'users' | 'phones'} RecipientScope */

export function MessagesPage() {
  const [meta, setMeta] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [routers, setRouters] = useState([]);
  const [broadcastRouterId, setBroadcastRouterId] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState(emptyTemplate);
  const [saving, setSaving] = useState(false);

  const [sendTemplateId, setSendTemplateId] = useState('');
  const [sendBodyOverride, setSendBodyOverride] = useState('');
  /** Send-time placeholders for maintenance etc. (see {{date}}, {{time_window}} in template help) */
  const [sendEventDate, setSendEventDate] = useState('');
  const [sendTimeWindow, setSendTimeWindow] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [audPppoe, setAudPppoe] = useState(true);
  const [audRemote, setAudRemote] = useState(false);
  const [audHotspot, setAudHotspot] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  /** @type {[RecipientScope, import('react').Dispatch<import('react').SetStateAction<RecipientScope>>]} */
  const [recipientScope, setRecipientScope] = useState(/** @type {RecipientScope} */ ('audiences'));
  /** @type {[Record<string, boolean>, import('react').Dispatch<any>]} */
  const [selectedUserIds, setSelectedUserIds] = useState({});
  const [customerSearch, setCustomerSearch] = useState('');
  const [intersectAudiences, setIntersectAudiences] = useState(false);
  const [phonesText, setPhonesText] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [smsStatus, setSmsStatus] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [m, t, l, u, r, sms] = await Promise.all([
        apiFetch('/api/message-templates/categories'),
        apiFetch('/api/message-templates?all=1'),
        apiFetch('/api/message-broadcasts?limit=25'),
        apiFetch('/api/users?limit=500'),
        apiFetch('/api/routers'),
        apiFetch('/api/message-broadcasts/sms-status'),
      ]);
      setMeta(m);
      setTemplates(Array.isArray(t) ? t : []);
      setLogs(Array.isArray(l) ? l : []);
      setCustomers(Array.isArray(u) ? u : []);
      setRouters(Array.isArray(r) ? r : []);
      setSmsStatus(sms && typeof sms === 'object' ? sms : null);
      setSendTemplateId((id) => {
        if (id) return id;
        const first = (Array.isArray(t) ? t : []).find((x) => x.isActive);
        return first?._id ? String(first._id) : '';
      });
    } catch (e) {
      setErr(e.message || 'Load failed');
    }
  }, []);

  useEffect(() => {
    load();
    apiFetch('/api/auth/me')
      .then((m) => {
        const superAdmin = m?.admin?.role === 'super_admin';
        setIsSuper(superAdmin);
        if (superAdmin) setAudRemote(true);
      })
      .catch(() => setIsSuper(false));
  }, [load]);

  async function sendTestSms(e) {
    e?.preventDefault?.();
    setTestBusy(true);
    setTestResult(null);
    setErr('');
    try {
      const r = await apiFetch('/api/message-broadcasts/test', {
        method: 'POST',
        body: JSON.stringify({ phone: testPhone.trim() }),
      });
      setTestResult(r);
      await load();
    } catch (e) {
      setErr(e.message || 'Test send failed');
    } finally {
      setTestBusy(false);
    }
  }

  async function createTemplate(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await apiFetch('/api/message-templates', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          body: form.body.trim(),
          description: form.description.trim() || undefined,
        }),
      });
      setForm(emptyTemplate);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleTemplate(row) {
    try {
      await apiFetch(`/api/message-templates/${row._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function deleteTemplate(row) {
    if (!window.confirm(`Delete template “${row.name}”?`)) return;
    try {
      await apiFetch(`/api/message-templates/${row._id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function buildMessagePayload() {
    if (sendBodyOverride.trim()) return { body: sendBodyOverride.trim() };
    if (sendTemplateId) return { templateId: sendTemplateId };
    return null;
  }

  function buildTemplateVarsPayload() {
    const vars = {};
    const iso = sendEventDate.trim();
    if (iso) {
      const d = new Date(`${iso}T12:00:00`);
      if (!Number.isNaN(d.getTime())) {
        vars.date_iso = iso;
        vars.date = d.toLocaleDateString(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    }
    const tw = sendTimeWindow.trim();
    if (tw) vars.time_window = tw.slice(0, 120);
    const n = sendNote.trim();
    if (n) vars.note = n.slice(0, 240);
    return Object.keys(vars).length ? { templateVars: vars } : {};
  }

  function buildRecipientPayload() {
    const audiences = {
      pppoe: audPppoe,
      remote: isSuper ? audRemote : false,
      hotspot: audHotspot,
    };
    const siteId = broadcastRouterId.trim();

    if (siteId) {
      if (recipientScope === 'phones') {
        return {
          error:
            'A site/router filter cannot be used with manual phone numbers. Clear the site or use segments or specific customers.',
        };
      }
      if (
        recipientScope === 'audiences' &&
        audiences.remote &&
        !audiences.pppoe &&
        !audiences.hotspot
      ) {
        return {
          error:
            'Remote subscribers are not tied to one router. Check PPPoE or hotspot, or clear the site filter.',
        };
      }
      if (
        recipientScope === 'users' &&
        intersectAudiences &&
        audiences.remote &&
        !audiences.pppoe &&
        !audiences.hotspot
      ) {
        return {
          error:
            'With “Match audience filters”, remote-only does not apply per site. Check PPPoE or hotspot, or clear the site.',
        };
      }
    }

    const sitePayload = siteId ? { routerId: siteId } : {};

    if (recipientScope === 'users') {
      const userIds = Object.keys(selectedUserIds).filter((id) => selectedUserIds[id]);
      if (userIds.length === 0) {
        return { error: 'Select at least one customer with a phone number.' };
      }
      if (intersectAudiences) {
        if (!audiences.pppoe && !audiences.remote && !audiences.hotspot) {
          return {
            error:
              'When using “Match audience filters”, check at least one segment (PPPoE, remote, or hotspot).',
          };
        }
        return { audiences, userIds, intersectAudiences: true, ...sitePayload };
      }
      return { userIds, audiences, ...sitePayload };
    }

    if (recipientScope === 'phones') {
      if (!phonesText.trim()) {
        return { error: 'Enter at least one phone number (Ghana: 0XX…, 233…, or one per line).' };
      }
      return { phones: phonesText, audiences, ...sitePayload };
    }

    if (!audiences.pppoe && !audiences.remote && !audiences.hotspot) {
      return { error: 'Select at least one audience segment, or switch to specific customers / phones.' };
    }
    return { audiences, ...sitePayload };
  }

  async function dryRun() {
    setSendBusy(true);
    setSendResult(null);
    setErr('');
    try {
      const msg = buildMessagePayload();
      if (!msg) {
        setErr('Choose a template or enter ad-hoc message text.');
        setSendBusy(false);
        return;
      }
      const rec = buildRecipientPayload();
      if (rec.error) {
        setErr(rec.error);
        setSendBusy(false);
        return;
      }
      const body = { ...msg, ...buildTemplateVarsPayload(), ...rec, dryRun: true };
      const r = await apiFetch('/api/message-broadcasts/send', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSendResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  async function sendLive() {
    if (!window.confirm('Send SMS to all selected recipients now? (uses Arkesel / mock)')) return;
    setSendBusy(true);
    setSendResult(null);
    setErr('');
    try {
      const msg = buildMessagePayload();
      if (!msg) {
        setErr('Choose a template or enter ad-hoc message text.');
        setSendBusy(false);
        return;
      }
      const rec = buildRecipientPayload();
      if (rec.error) {
        setErr(rec.error);
        setSendBusy(false);
        return;
      }
      const body = { ...msg, ...buildTemplateVarsPayload(), ...rec, dryRun: false };
      const r = await apiFetch('/api/message-broadcasts/send', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSendResult(r);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSendBusy(false);
    }
  }

  const customersWithPhone = customers.filter((u) => u.phone && String(u.phone).trim());
  const q = customerSearch.trim().toLowerCase();
  const filteredCustomers = q
    ? customersWithPhone.filter((u) => {
        const blob = [u.fullName, u.phone, u.email].filter(Boolean).join(' ').toLowerCase();
        return blob.includes(q);
      })
    : customersWithPhone;

  function toggleUser(id) {
    setSelectedUserIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAllFiltered() {
    setSelectedUserIds((prev) => {
      const next = { ...prev };
      for (const u of filteredCustomers) {
        next[u._id] = true;
      }
      return next;
    });
  }

  function clearUserSelection() {
    setSelectedUserIds({});
  }

  const selectedCount = Object.keys(selectedUserIds).filter((id) => selectedUserIds[id]).length;

  function logRecipientLabel(log) {
    const mode = log.recipientMode || 'audiences';
    const map = {
      audiences: 'Segments',
      user_ids: 'Specific customers',
      user_ids_filtered: 'Specific + segment filter',
      manual_phones: 'Manual phones',
    };
    return map[mode] || mode;
  }

  const categoryOptions = meta?.categories || [];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-white">Message templates &amp; SMS</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Create templates by category (updates, maintenance, 3‑day expiry reminder, expired notices, general expiry,
          welcome, emergency, technical issue, custom). Send to{' '}
          <strong className="text-slate-300">whole segments</strong> (PPPoE only counts{' '}
          <strong className="text-slate-300">linked customers with a phone</strong>; remote / hotspot as documented), to{' '}
          <strong className="text-slate-300">hand-picked customers</strong> from your directory, or to a{' '}
          <strong className="text-slate-300">manual list of numbers</strong>. You can also require that selected
          customers <strong className="text-slate-300">also</strong> belong to checked segments (intersection).
          <strong className="text-slate-300">Test SMS</strong> always uses the global brand from env (not per-router).
          For <strong className="text-slate-300">broadcasts</strong>, you can pick a site below to message{' '}
          <strong className="text-slate-300">everyone on that router</strong> (by segment: PPPoE and/or hotspot
          customers linked to that router), using that site&apos;s SMS name in <code className="text-slate-400">{'{{brand}}'}</code>.
          The <strong className="text-slate-300">Expiry reminder (~3 days before)</strong> template is used automatically for
          PPPoE (linked user with phone) and remote-access lines whose <code className="text-slate-500">paidUntil</code> falls
          within the next few days — enable on the server with{' '}
          <code className="text-slate-500">EXPIRY_REMINDER_SMS_ENABLED=true</code>{' '}
          (see <code className="text-slate-500">EXPIRY_REMINDER_DAYS</code>,{' '}
          <code className="text-slate-500">EXPIRY_REMINDER_SMS_CRON</code>). Template placeholders include{' '}
          <code className="text-slate-400">{'{{brand}} {{name}} {{paidUntil}} {{package}} {{secret}} {{renew_code}} {{renew_url}} {{service_type}}'}</code>
          . Broadcasts personalize <code className="text-slate-400">{'{{renew_code}}'}</code> per PPPoE customer.
          Remote-only and manual phone lists cannot be combined with a site filter. Anonymous hotspot buyers (no user
          account) are never in segment lists.
        </p>
      </div>

      {err && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">Send broadcast</h2>
        {smsStatus && (
          <div
            className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
              smsStatus.live
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100'
                : smsStatus.mock
                  ? 'border-amber-500/40 bg-amber-950/20 text-amber-100'
                  : 'border-slate-600 bg-slate-950/50 text-slate-300'
            }`}
          >
            <p className="font-medium">
              {smsStatus.live
                ? 'Live SMS — Arkesel API is active'
                : smsStatus.mock
                  ? 'Mock mode — SMS only logged on the server'
                  : 'Not ready — add API key and sender ID, set ARKESEL_MOCK=false'}
            </p>
            {!smsStatus.live && (
              <p className="mt-1 text-xs opacity-90">
                Env: <code className="rounded bg-black/30 px-1">ARKESEL_API_KEY</code>,{' '}
                <code className="rounded bg-black/30 px-1">ARKESEL_SENDER_ID</code>,{' '}
                <code className="rounded bg-black/30 px-1">ARKESEL_MOCK=false</code>
              </p>
            )}
            {smsStatus.live && smsStatus.sendConcurrency != null && (
              <p className="mt-1 text-xs text-emerald-200/80">
                Broadcasts send up to {smsStatus.sendConcurrency} messages in parallel (see ARKESEL_SEND_CONCURRENCY).
              </p>
            )}
          </div>
        )}
        <form onSubmit={sendTestSms} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <label className="min-w-[200px] flex-1 text-sm text-slate-300">
            Test live SMS
            <input
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="024xxxxxxx or 233…"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={testBusy || !testPhone.trim()}
            className="rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {testBusy ? 'Sending…' : 'Send test'}
          </button>
        </form>
        {testResult && (
          <p
            className={`mt-2 text-sm ${testResult.ok ? 'text-emerald-300' : 'text-amber-200'}`}
            role="status"
          >
            {testResult.message || testResult.error || JSON.stringify(testResult)}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Test uses global <code className="rounded bg-slate-800 px-1">ARKESEL_SENDER_ID</code> / brand only — not
          per-router settings.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Placeholders in templates:{' '}
          {meta?.placeholders?.map((p) => (
            <code key={p} className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-violet-300">
              {p}
            </code>
          ))}
        </p>
        {meta?.templateVarsHelp && (
          <p className="mt-1 text-xs text-slate-500">{meta.templateVarsHelp}</p>
        )}

        <div className="mt-4 space-y-4">
          <label className="block max-w-xl text-sm text-slate-300">
            Site for this broadcast (optional)
            <select
              value={broadcastRouterId}
              onChange={(e) => setBroadcastRouterId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">All sites — every matching customer, global SMS brand</option>
              {routers.map((rt) => (
                <option key={rt._id} value={rt._id}>
                  {rt.comment?.trim() || rt.name || rt.host}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs leading-relaxed text-slate-500">
              To reach <strong className="text-slate-400">everyone on one router</strong>: leave recipient mode on{' '}
              <strong className="text-slate-400">By segment</strong>, choose the site here, then check{' '}
              <strong className="text-slate-400">PPPoE</strong> (all subscriber accounts on that router) and/or{' '}
              <strong className="text-slate-400">Hotspot</strong> (registered voucher buyers for that router). Checked
              segments are combined (union — same phone once). <code className="rounded bg-slate-800 px-1">{'{{brand}}'}</code>{' '}
              uses that site&apos;s name from <strong className="text-slate-400">Routers → Advanced → SMS</strong>.
            </span>
          </label>
          <label className="block text-sm text-slate-300">
            Template
            <select
              value={sendTemplateId}
              onChange={(e) => setSendTemplateId(e.target.value)}
              className="mt-1 w-full max-w-xl rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">— Ad-hoc body below —</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id} disabled={!t.isActive}>
                  [{t.category}] {t.name} {!t.isActive ? '(inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300">
            Or ad-hoc message (overrides template when not empty)
            <textarea
              value={sendBodyOverride}
              onChange={(e) => setSendBodyOverride(e.target.value)}
              rows={3}
              placeholder="{{brand}}: Hello {{name}}, …"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
            />
          </label>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Send-time details (optional)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Use in your template as <code className="text-violet-300">{'{{date}}'}</code> (friendly text),{' '}
              <code className="text-violet-300">{'{{date_iso}}'}</code> (YYYY-MM-DD),{' '}
              <code className="text-violet-300">{'{{time_window}}'}</code>, or{' '}
              <code className="text-violet-300">{'{{note}}'}</code>. Example: “Maintenance on{' '}
              <code className="text-violet-300">{'{{date}}'}</code> from <code className="text-violet-300">{'{{time_window}}'}</code>.”
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Event / maintenance date
                <input
                  type="date"
                  value={sendEventDate}
                  onChange={(e) => setSendEventDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block text-sm text-slate-300">
                Time window (e.g. 2:00–4:00 AM)
                <input
                  type="text"
                  value={sendTimeWindow}
                  onChange={(e) => setSendTimeWindow(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="mt-3 block text-sm text-slate-300">
              Short note (optional)
              <input
                type="text"
                value={sendNote}
                onChange={(e) => setSendNote(e.target.value)}
                placeholder="e.g. Wi-Fi may drop briefly"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <fieldset className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <legend className="px-2 text-xs font-medium text-slate-400">Who receives this</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { id: /** @type {RecipientScope} */ ('audiences'), label: 'By segment' },
                { id: /** @type {RecipientScope} */ ('users'), label: 'Specific customers' },
                { id: /** @type {RecipientScope} */ ('phones'), label: 'Manual phone numbers' },
              ].map((opt) => (
                <label
                  key={opt.id}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    recipientScope === opt.id
                      ? 'border-teal-500/50 bg-teal-950/40 text-teal-100'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="recv-scope"
                    className="sr-only"
                    checked={recipientScope === opt.id}
                    onChange={() => setRecipientScope(opt.id)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>

            {recipientScope === 'audiences' && (
              <p className="mt-3 text-xs text-slate-500">
                Union of everyone matching the segments you check (same phone appears once).
              </p>
            )}
            {recipientScope === 'users' && (
              <p className="mt-3 text-xs text-slate-500">
                Only checked customers (must have a phone on their profile). Optional: also require they appear in
                segment rules below.
              </p>
            )}
            {recipientScope === 'phones' && (
              <p className="mt-3 text-xs text-slate-500">
                Numbers are normalized to Ghana 233…; invalid lines are skipped.
              </p>
            )}
          </fieldset>

          {recipientScope === 'users' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">
                  Customers <span className="text-slate-500">({selectedCount} selected)</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Select all in list
                  </button>
                  <button
                    type="button"
                    onClick={clearUserSelection}
                    className="rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <input
                type="search"
                placeholder="Search name, phone, email…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={intersectAudiences}
                  onChange={(e) => setIntersectAudiences(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <strong className="text-white">Match audience filters</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Only send to selected customers who also qualify for the checked segments below (intersection by
                    phone).
                  </span>
                </span>
              </label>
              <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-slate-800">
                {filteredCustomers.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-500">
                    {customersWithPhone.length === 0
                      ? 'No customers with a phone — add phones under Customers or PPPoE.'
                      : 'No matches.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800 text-sm">
                    {filteredCustomers.map((u) => (
                      <li key={u._id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-900/80">
                        <input
                          type="checkbox"
                          checked={!!selectedUserIds[u._id]}
                          onChange={() => toggleUser(u._id)}
                          className="rounded border-slate-600"
                        />
                        <span className="min-w-0 flex-1 text-slate-300">
                          {[u.fullName, u.email].filter(Boolean).join(' · ') || 'Customer'}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-violet-300">{u.phone}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {recipientScope === 'phones' && (
            <label className="block text-sm text-slate-300">
              Phone numbers
              <textarea
                value={phonesText}
                onChange={(e) => setPhonesText(e.target.value)}
                rows={5}
                placeholder={'024xxxxxxx\n23324xxxxxxx\n(one per line, or comma-separated)'}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </label>
          )}

          <fieldset className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <legend className="px-2 text-xs font-medium text-slate-400">
              {recipientScope === 'users' && intersectAudiences
                ? 'Audience filter (intersection)'
                : recipientScope === 'audiences'
                  ? 'Segments'
                  : 'Segments (optional context)'}
            </legend>
            {(recipientScope === 'phones' || (recipientScope === 'users' && !intersectAudiences)) && (
              <p className="mb-2 text-xs text-slate-500">
                {recipientScope === 'phones'
                  ? 'Not used for manual numbers unless you later add intersection support.'
                  : 'Not applied — all selected customers receive the message.'}
              </p>
            )}
            <div className="mt-2 space-y-2 text-sm text-slate-300">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={audPppoe}
                  onChange={(e) => setAudPppoe(e.target.checked)}
                  disabled={recipientScope === 'phones'}
                  className="mt-1 disabled:opacity-40"
                />
                <span>
                  <strong className="text-white">PPPoE-linked</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {meta?.audienceHelp?.pppoe}
                  </span>
                </span>
              </label>
              {isSuper ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={audRemote}
                    onChange={(e) => setAudRemote(e.target.checked)}
                    disabled={recipientScope === 'phones'}
                    className="mt-1 disabled:opacity-40"
                  />
                  <span>
                    <strong className="text-white">Remote access</strong>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {meta?.audienceHelp?.remote}
                    </span>
                  </span>
                </label>
              ) : null}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={audHotspot}
                  onChange={(e) => setAudHotspot(e.target.checked)}
                  disabled={recipientScope === 'phones'}
                  className="mt-1 disabled:opacity-40"
                />
                <span>
                  <strong className="text-white">Hotspot (registered only)</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {meta?.audienceHelp?.hotspot}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={sendBusy}
              onClick={() => dryRun()}
              className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              Preview (dry run)
            </button>
            <button
              type="button"
              disabled={sendBusy}
              onClick={() => sendLive()}
              className="rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/30 disabled:opacity-50"
            >
              Send SMS
            </button>
          </div>

          {sendResult && (
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
              {sendResult.dryRun ? (
                <>
                  <p className="font-medium text-white">Dry run</p>
                  <p className="mt-1">
                    Recipients: <strong>{sendResult.recipientCount}</strong>
                  </p>
                  {sendResult.samples?.length > 0 && (
                    <ul className="mt-3 space-y-2 font-mono text-xs text-slate-400">
                      {sendResult.samples.map((s, i) => (
                        <li key={i}>
                          <span className="text-violet-400">{s.phone}</span> — {s.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium text-white">Sent</p>
                  <p className="mt-1">
                    Recipients: {sendResult.recipientCount} · OK: {sendResult.sent} · Failed:{' '}
                    {sendResult.failed}
                  </p>
                  {sendResult.errors?.length > 0 && (
                    <ul className="mt-2 text-xs text-red-300">
                      {sendResult.errors.map((e, i) => (
                        <li key={i}>
                          {e.phone}: {e.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium text-white">Recent broadcasts</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Count</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {logs.map((log) => (
                <tr key={log._id} className="text-slate-400">
                  <td className="px-4 py-2">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-300">{log.templateName || 'Ad-hoc'}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-300">{logRecipientLabel(log)}</span>
                    {log.recipientMode === 'audiences' ||
                    log.recipientMode === 'user_ids_filtered' ||
                    !log.recipientMode ? (
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                        {[log.audiences?.pppoe && 'pppoe', log.audiences?.remote && 'remote', log.audiences?.hotspot && 'hotspot']
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </span>
                    ) : null}
                    {log.smsBrandUsed ? (
                      <span className="mt-0.5 block text-[10px] text-teal-500/90">
                        Site brand: {log.smsBrandUsed}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{log.recipientCount}</td>
                  <td className="px-4 py-2">
                    {log.dryRun ? (
                      <span className="text-amber-400">dry run</span>
                    ) : (
                      <span className="text-emerald-400">
                        sent {log.sent}/{log.recipientCount}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No broadcasts yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-lg font-medium text-white">New template</h2>
        <form onSubmit={createTemplate} className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Category
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-300 sm:col-span-2">
            SMS body
            <textarea
              required
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={4}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              placeholder="{{brand}}: Hi {{name}}, …"
            />
          </label>
          <label className="block text-sm text-slate-300 sm:col-span-2">
            Internal description (optional)
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="tpl-active"
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            <label htmlFor="tpl-active" className="text-sm text-slate-400">
              Active (available for sending)
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 sm:col-span-2"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium text-white">Saved templates</h2>
        <div className="mt-3 space-y-3">
          {templates.map((t) => (
            <div
              key={t._id}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-white">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.category}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleTemplate(t)}
                    className={`rounded-lg px-2 py-1 text-xs ${
                      t.isActive ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {t.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(t)}
                    className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900/80 p-3 font-mono text-xs text-slate-400">
                {t.body}
              </pre>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="text-sm text-slate-500">No templates — create one above.</p>
          )}
        </div>
      </section>
    </div>
  );
}

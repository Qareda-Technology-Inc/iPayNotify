import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { setActingOrganizationId } from '../authStorage.js';
import { TeamManager } from '../components/TeamManager.jsx';
import { OrgStatusPill, orgInitials } from './SuperAdminOrganizationsPage.jsx';

export function SuperAdminOrgAdminsPage() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteFocus = searchParams.get('invite') === '1';

  const [org, setOrg] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOrg = useCallback(async () => {
    if (!orgId) return;
    setErr('');
    try {
      const orgs = await apiFetch('/api/super-admin/organizations');
      const o = (Array.isArray(orgs) ? orgs : []).find((x) => String(x._id) === String(orgId));
      setOrg(o || null);
    } catch (e) {
      setErr(e.message || 'Load failed');
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/super/organizations" className="inline-flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300">
        <span aria-hidden>←</span> Organisations
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-base font-semibold text-indigo-200 ring-1 ring-inset ring-indigo-500/30">
            {org ? orgInitials(org.name) : '…'}
          </div>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-white">
              <span className="truncate">{org ? org.name : loading ? 'Loading…' : 'Organisation not found'}</span>
              {org ? <OrgStatusPill status={org.status} /> : null}
            </h1>
            {org ? (
              <p className="mt-0.5 text-xs text-slate-400">
                <span className="font-mono">{org.slug}</span> · {org.usage?.routers ?? 0} router
                {(org.usage?.routers ?? 0) === 1 ? '' : 's'} · Team management
              </p>
            ) : null}
          </div>
        </div>
        {org ? (
          <button
            type="button"
            onClick={() => {
              setActingOrganizationId(org._id, org.name);
              navigate('/');
            }}
            className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-950/70"
          >
            Open dashboard
          </button>
        ) : null}
      </div>

      {inviteFocus ? (
        <p className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-100">
          Organisation created — invite the first admin so they can sign in.
        </p>
      ) : null}
      {err ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</p>
      ) : null}

      {orgId ? (
        <TeamManager
          apiBase={`/api/super-admin/organizations/${orgId}/admins`}
          maxAdmins={org?.limits?.maxAdmins ?? null}
          defaultRole="org_admin"
          autoOpenInvite={inviteFocus && Boolean(org)}
          disabled={!org}
          onChanged={loadOrg}
        />
      ) : null}
    </div>
  );
}

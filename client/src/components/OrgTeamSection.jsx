import { TeamManager } from './TeamManager.jsx';

/**
 * Org-admin self-serve team management (uses /api/organization/admins).
 */
export function OrgTeamSection({ canManage, limits, currentAdminId, onChanged }) {
  if (!canManage) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg font-medium text-white">Team</h2>
        <p className="mt-2 text-sm text-slate-500">
          Only organisation admins can invite, edit or remove team members.
        </p>
      </section>
    );
  }

  return (
    <TeamManager
      apiBase="/api/organization/admins"
      currentAdminId={currentAdminId}
      maxAdmins={limits?.maxAdmins ?? null}
      defaultRole="org_staff"
      onChanged={onChanged}
    />
  );
}

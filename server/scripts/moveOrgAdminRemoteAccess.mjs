/**
 * People who run an organisation are billed through it (org price + price per router), so their
 * separate remote-access subscriptions go away. This finds remote-access subscriptions whose phone
 * or email belongs to an organisation admin.
 *
 * Report (default): lists each match and what would happen.
 * --apply: moves the subscription's router (and its WireGuard tunnel) into the admin's own
 *          organisation, where it is counted on the monthly bill, then deletes the subscription.
 *          Routers that still have PPPoE accounts or vouchers where they are now are skipped.
 *
 * Usage (from server/):
 *   node scripts/moveOrgAdminRemoteAccess.mjs
 *   node scripts/moveOrgAdminRemoteAccess.mjs --apply
 *   npm run db:move-org-admin-remote-access -- --apply
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import {
  Admin,
  HotspotVoucher,
  Organization,
  PppoeAccount,
  RemoteAccessSubscription,
  Router,
} from '../src/models/index.js';
import { WireGuardPeer } from '../src/models/WireGuardPeer.js';
import { normalizeGhanaMsisdn } from '../src/utils/phoneGhana.js';

const ORG_ROLES = ['org_admin', 'org_staff', 'ticket_manager'];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(config.mongoUri);
  try {
    const admins = await Admin.find({ role: { $in: ORG_ROLES }, organizationId: { $ne: null } })
      .select('email phone organizationId')
      .lean();
    const byPhone = new Map();
    const byEmail = new Map();
    for (const a of admins) {
      const p = normalizeGhanaMsisdn(a.phone);
      if (p) byPhone.set(p, a);
      const e = String(a.email || '').trim().toLowerCase();
      if (e) byEmail.set(e, a);
    }
    const orgNames = new Map(
      (await Organization.find().select('name').lean()).map((o) => [String(o._id), o.name])
    );

    const subs = await RemoteAccessSubscription.find().lean();
    let matched = 0;
    let moved = 0;
    let skipped = 0;
    for (const sub of subs) {
      const admin =
        byPhone.get(normalizeGhanaMsisdn(sub.phone)) || byEmail.get(String(sub.email || '').trim().toLowerCase());
      if (!admin) continue;
      matched += 1;
      const targetOrg = String(admin.organizationId);
      const router = sub.routerId ? await Router.findById(sub.routerId).select('name host organizationId').lean() : null;
      const label = `${sub.displayName || sub.phone} → ${orgNames.get(targetOrg) || targetOrg}`;

      if (!router) {
        console.log(`  ${label}: no router linked — subscription ${apply ? 'deleted' : 'would be deleted'}`);
        if (apply) await RemoteAccessSubscription.deleteOne({ _id: sub._id });
        moved += 1;
        continue;
      }
      const sameOrg = String(router.organizationId) === targetOrg;
      const [pppoe, vouchers] = sameOrg
        ? [0, 0]
        : await Promise.all([
            PppoeAccount.countDocuments({ routerId: router._id, organizationId: router.organizationId }),
            HotspotVoucher.countDocuments({ routerId: router._id, organizationId: router.organizationId }),
          ]);
      if (pppoe || vouchers) {
        skipped += 1;
        console.log(
          `  ${label}: SKIP router "${router.name}" has ${pppoe} PPPoE accounts and ${vouchers} vouchers in ` +
            `${orgNames.get(String(router.organizationId)) || router.organizationId}; move it by hand`
        );
        continue;
      }
      console.log(
        `  ${label}: router "${router.name}" (${router.host}) ${sameOrg ? 'already in their organisation' : 'moves to their organisation'}` +
          `, subscription ${apply ? 'deleted' : 'would be deleted'}`
      );
      if (apply) {
        if (!sameOrg) {
          await Router.updateOne({ _id: router._id }, { $set: { organizationId: admin.organizationId } });
          await WireGuardPeer.updateMany(
            { $or: [{ claimedRouterId: router._id }, { kind: { $ne: 'client' }, tunnelIp: router.host }] },
            { $set: { organizationId: admin.organizationId } }
          );
        }
        await RemoteAccessSubscription.deleteOne({ _id: sub._id });
      }
      moved += 1;
    }

    console.log(
      `\nRemote-access subscriptions: ${subs.length}. Owned by organisation admins: ${matched}. ` +
        `${apply ? 'Moved' : 'To move'}: ${moved}. Skipped: ${skipped}.`
    );
    if (!apply && moved) console.log('Report only. Re-run with --apply to move them.');
    if (apply && moved) {
      console.log('Set each organisation’s price per router in Super admin → Organisations → Edit → Billing.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

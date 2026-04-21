/**
 * Set role=super_admin and clear organizationId for admins missing role (legacy installs).
 * Run from server/: `npm run db:backfill-admin-roles`
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Admin } from '../src/models/index.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  try {
    const res = await Admin.updateMany(
      { $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
      { $set: { role: 'super_admin', organizationId: null } }
    );
    console.log('Updated admins (missing role) → super_admin:', res.modifiedCount, '/', res.matchedCount);
    const orgAdminsBad = await Admin.countDocuments({
      role: 'org_admin',
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    });
    if (orgAdminsBad > 0) {
      console.warn(
        '[WARN] There are',
        orgAdminsBad,
        'org_admin account(s) without organisationId — fix manually in MongoDB.'
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

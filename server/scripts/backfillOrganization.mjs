/**
 * One-time (or idempotent) migration: create the default SaaS tenant and set organizationId
 * on all existing business data. Safe to run multiple times — only updates docs missing organizationId.
 *
 * Usage (from server/):
 *   node scripts/backfillOrganization.mjs
 *
 * Optional env:
 *   ORG_BACKFILL_NAME="Qaretech Innovative"
 *   ORG_BACKFILL_SLUG="qaretech-innovative"
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import {
  Organization,
  Router,
  User,
  PlanPackage,
  PppoeAccount,
  Transaction,
  RemoteAccessSubscription,
  MessageTemplate,
  MessageBroadcastLog,
  HotspotVoucher,
  BillingJobRun,
} from '../src/models/index.js';

const ORG_NAME = String(process.env.ORG_BACKFILL_NAME || 'Qaretech Innovative').trim();
const ORG_SLUG = String(process.env.ORG_BACKFILL_SLUG || 'qaretech-innovative')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '-');

const missingOrgFilter = {
  $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
};

async function main() {
  await mongoose.connect(config.mongoUri);
  try {
    let org = await Organization.findOne({ slug: ORG_SLUG });
    if (!org) {
      org = await Organization.create({
        name: ORG_NAME,
        slug: ORG_SLUG,
        status: 'active',
      });
      console.log(`Created organization "${org.name}" (${org.slug})`);
    } else {
      console.log(`Using existing organization "${org.name}" (${org.slug})`);
    }

    console.log('\norganizationId for this tenant (use in env or code):\n', String(org._id), '\n');

    const pairs = [
      ['routers', Router],
      ['users', User],
      ['packages', PlanPackage],
      ['pppoeaccounts', PppoeAccount],
      ['transactions', Transaction],
      ['remoteaccesssubscriptions', RemoteAccessSubscription],
      ['messagetemplates', MessageTemplate],
      ['messagebroadcastlogs', MessageBroadcastLog],
      ['hotspotvouchers', HotspotVoucher],
      ['billingjobruns', BillingJobRun],
    ];

    for (const [label, Model] of pairs) {
      const res = await Model.updateMany(missingOrgFilter, {
        $set: { organizationId: org._id },
      });
      console.log(`${label}: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
    }

    console.log('\nDone. Run `npm run db:sync-indexes` if you want Mongoose to sync new indexes.\n');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

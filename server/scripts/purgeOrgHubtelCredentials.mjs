/**
 * Remove legacy per-organisation Hubtel credentials from Organization.billing.
 * Checkout only uses the platform HUBTEL_* env keys, so these values are unused —
 * but some orgs saved real client secrets while the form existed (July 2026).
 *
 * Usage (from server/):
 *   node scripts/purgeOrgHubtelCredentials.mjs           # report only
 *   node scripts/purgeOrgHubtelCredentials.mjs --apply   # delete the fields
 *   npm run db:purge-org-hubtel-credentials -- --apply
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Organization } from '../src/models/index.js';

const FIELDS = [
  'useCustomHubtel',
  'hubtelMerchantAccount',
  'hubtelClientId',
  'hubtelClientSecret',
  'hubtelClientSecretSet',
  'hubtelCallbackUrl',
];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(config.mongoUri);
  try {
    const query = { $or: FIELDS.map((f) => ({ [`billing.${f}`]: { $exists: true } })) };
    const rows = await Organization.collection
      .find(query, { projection: { name: 1, slug: 1, billing: 1 } })
      .toArray();

    console.log(`Organisations with legacy Hubtel fields: ${rows.length}`);
    for (const row of rows) {
      const b = row.billing || {};
      const present = FIELDS.filter((f) => b[f] !== undefined);
      const hasSecret = Boolean(String(b.hubtelClientSecret || '').trim());
      console.log(`  ${row.slug || row.name}: ${present.join(', ')}${hasSecret ? '  (secret stored)' : ''}`);
    }

    if (!apply) {
      console.log('\nReport only. Re-run with --apply to delete these fields.');
      return;
    }
    if (!rows.length) return;

    const unset = Object.fromEntries(FIELDS.map((f) => [`billing.${f}`, '']));
    const res = await Organization.collection.updateMany(query, { $unset: unset });
    console.log(`\nDone. Cleared legacy Hubtel fields on ${res.modifiedCount} organisation(s).`);
    console.log('If any secret was real, rotate it in the Hubtel merchant portal.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

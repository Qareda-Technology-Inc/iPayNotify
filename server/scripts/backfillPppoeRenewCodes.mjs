/**
 * Assign platform-unique renewCode to every PPPoE account missing one.
 * Safe to run multiple times.
 *
 * Usage (from server/):
 *   node scripts/backfillPppoeRenewCodes.mjs
 *   npm run db:backfill-pppoe-renew-codes
 *
 * Then (optional):
 *   npm run db:sync-indexes
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { PppoeAccount } from '../src/models/index.js';
import { allocateUniqueRenewCode } from '../src/utils/renewCode.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  try {
    const missing = await PppoeAccount.find({
      $or: [{ renewCode: { $exists: false } }, { renewCode: null }, { renewCode: '' }],
    })
      .select('_id secretName')
      .lean();

    console.log(`PPPoE accounts missing renewCode: ${missing.length}`);
    let updated = 0;
    for (const row of missing) {
      const renewCode = await allocateUniqueRenewCode();
      await PppoeAccount.updateOne({ _id: row._id }, { $set: { renewCode } });
      updated += 1;
      if (updated <= 5 || updated % 50 === 0) {
        console.log(`  ${updated}/${missing.length}: ${row.secretName} → ${renewCode}`);
      }
    }
    console.log(`\nDone. Updated ${updated} account(s).`);
    console.log('Run `npm run db:sync-indexes` to ensure the unique renewCode index exists.\n');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

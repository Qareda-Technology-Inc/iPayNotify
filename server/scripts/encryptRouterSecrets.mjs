/**
 * Encrypt router apiPassword / sshPassword values still stored as plaintext.
 * Requires ROUTER_SECRET_KEY in server/.env. Safe to run multiple times.
 *
 * Usage (from server/):
 *   node scripts/encryptRouterSecrets.mjs
 *   npm run db:encrypt-router-secrets
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Router } from '../src/models/index.js';
import {
  encryptSecret,
  isEncryptedSecret,
  secretEncryptionEnabled,
} from '../src/utils/secretBox.js';

const FIELDS = ['apiPassword', 'sshPassword'];

async function main() {
  if (!secretEncryptionEnabled()) {
    console.error('ROUTER_SECRET_KEY is not set. Generate one with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  await mongoose.connect(config.mongoUri);
  try {
    const rows = await Router.find({}).select('_id name apiPassword +sshPassword').lean();
    let updated = 0;
    for (const row of rows) {
      const set = {};
      for (const f of FIELDS) {
        const v = row[f];
        if (v && !isEncryptedSecret(v)) set[f] = encryptSecret(v);
      }
      if (!Object.keys(set).length) continue;
      /* Raw collection write: values are already encrypted, skip schema setters. */
      await Router.collection.updateOne({ _id: row._id }, { $set: set });
      updated += 1;
      console.log(`  ${row.name}: encrypted ${Object.keys(set).join(', ')}`);
    }
    console.log(`\nDone. ${updated} of ${rows.length} router(s) updated.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

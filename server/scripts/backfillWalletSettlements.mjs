/**
 * Credit organisation wallets for paid Hubtel sales that never got walletSettled.
 * Safe / idempotent — settlePaidTransactionToWallet skips duplicates.
 *
 * Usage (from server/): npm run db:backfill-wallet-settlements
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Transaction } from '../src/models/index.js';
import { settlePaidTransactionToWallet } from '../src/services/orgWalletService.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  const q = {
    status: 'paid',
    organizationId: { $exists: true, $ne: null },
    $or: [
      { 'meta.walletSettled': { $ne: true } },
      { 'meta.walletSettled': { $exists: false } },
    ],
  };
  const total = await Transaction.countDocuments(q);
  console.log(`[backfill-wallet] unpaid settlements to process: ${total}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const cursor = Transaction.find(q).sort({ createdAt: 1 }).cursor();
  for await (const tx of cursor) {
    try {
      const r = await settlePaidTransactionToWallet(tx);
      if (r?.ok) {
        if (r.duplicate) skipped += 1;
        else ok += 1;
      } else {
        skipped += 1;
        console.warn(`[backfill-wallet] skip ${tx.clientReference}: ${r?.reason || 'unknown'}`);
      }
    } catch (e) {
      failed += 1;
      console.error(`[backfill-wallet] fail ${tx.clientReference}:`, e?.message || e);
    }
  }

  console.log(`[backfill-wallet] done. credited=${ok} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import mongoose from 'mongoose';

/** Merchant settlement ledger for a tenant (Hubtel sales net of platform fee, withdrawals). */
const orgLedgerEntrySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['sale_credit', 'platform_fee', 'withdrawal', 'adjustment'],
      required: true,
    },
    /** Signed: credits +, debits − */
    amountCents: { type: Number, required: true },
    balanceAfterCents: { type: Number, required: true },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      index: true,
    },
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WithdrawalRequest',
      index: true,
    },
    note: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

orgLedgerEntrySchema.index({ organizationId: 1, createdAt: -1 });
orgLedgerEntrySchema.index(
  { organizationId: 1, transactionId: 1, type: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: 'objectId' } } }
);

export const OrgLedgerEntry =
  mongoose.models.OrgLedgerEntry || mongoose.model('OrgLedgerEntry', orgLedgerEntrySchema);

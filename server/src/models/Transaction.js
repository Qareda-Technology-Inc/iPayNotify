import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanPackage' },
    pppoeAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'PppoeAccount' },
    hotspotVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotVoucher' },
    amountCents: { type: Number, required: true },
    currency: { type: String, default: 'GHS' },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      required: true,
    },
    provider: { type: String, default: 'mtn_momo' },
    providerReference: { type: String },
    /** Your reference sent to MTN as externalId; used in callbacks to match the transaction */
    clientReference: { type: String, unique: true, sparse: true },
    customerPhone: { type: String },
    customerName: { type: String },
    kind: {
      type: String,
      enum: ['subscription', 'voucher', 'renewal', 'topup'],
      required: true,
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });

export const Transaction =
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

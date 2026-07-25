import mongoose from 'mongoose';

/** Authoritative PPPoE row; push to MikroTik only when billing state changes. */
const pppoeAccountSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    /** Billing customer; optional for admin-created lines (walk-in). */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanPackage' },
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true },
    secretName: { type: String, required: true },
    secretPassword: { type: String, required: true },
    /**
     * Platform-unique online renew ID (e.g. QF7K2M9P).
     * Customers enter this (or registered phone) to renew without a site slug.
     */
    renewCode: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
    service: { type: String, default: 'pppoe' },
    activeProfile: { type: String, required: true },
    expiredProfile: { type: String, required: true },
    paidUntil: { type: Date, required: true },
    disabled: { type: Boolean, default: false },
    mikrotikInternalId: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);

pppoeAccountSchema.index({ paidUntil: 1 });
pppoeAccountSchema.index({ userId: 1 });
pppoeAccountSchema.index({ routerId: 1, secretName: 1 }, { unique: true });

export const PppoeAccount =
  mongoose.models.PppoeAccount || mongoose.model('PppoeAccount', pppoeAccountSchema);

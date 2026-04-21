import mongoose from 'mongoose';
import { defaultRenewalSmsBodyForKind } from '../utils/defaultRenewalSms.js';

/** Sellable plan (PPPoE subscription template or hotspot voucher template). */
const planPackageSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    name: { type: String, required: true },
    kind: { type: String, enum: ['pppoe', 'hotspot', 'remote_access'], required: true },
    priceCents: { type: Number, default: 0 },
    currency: { type: String, default: 'GHS' },
    /** @deprecated Prefer durationAmount + durationUnit; still supported for existing data. */
    durationDays: { type: Number },
    /** Length of one billing period (with durationUnit). */
    durationAmount: { type: Number },
    durationUnit: {
      type: String,
      enum: ['minute', 'hour', 'day', 'month'],
      default: 'day',
    },
    dataLimitBytes: { type: Number },
    timeLimitSeconds: { type: Number },
    /** MikroTik PPP profile names — not used for remote_access plans. */
    activeProfile: {
      type: String,
      required() {
        return this.kind !== 'remote_access';
      },
    },
    expiredProfile: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    /** SMS body for renewal (MoMo, admin renew, auto-renew). Placeholders: {{brand}}, {{name}}, {{package}}, {{paidUntil}}, {{secret}}, {{phone}} */
    renewalSmsBody: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'packages' }
);

planPackageSchema.pre('save', function initRenewalSms(next) {
  if (this.isNew && !String(this.renewalSmsBody || '').trim()) {
    this.renewalSmsBody = defaultRenewalSmsBodyForKind(this.kind);
  }
  next();
});

planPackageSchema.index({ kind: 1, isActive: 1 });

export const PlanPackage =
  mongoose.models.PlanPackage || mongoose.model('PlanPackage', planPackageSchema);

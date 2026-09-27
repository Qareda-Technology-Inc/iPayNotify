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
    /** Length of one billing period (with durationUnit). PPPoE / remote; hotspot uses elapsed/paused. */
    durationAmount: { type: Number },
    durationUnit: {
      type: String,
      enum: ['minute', 'hour', 'day', 'month'],
      default: 'day',
    },
    dataLimitBytes: { type: Number },
    /** @deprecated Prefer pausedSeconds for hotspot; still synced as limit-uptime. */
    timeLimitSeconds: { type: Number },

    /* —— Hotspot voucher template —— */
    /** How many concurrent devices may use one code. */
    usersPerTicket: { type: Number, default: 1, min: 1 },
    /** Upload cap in Mbps (client → internet). */
    speedUpMbps: { type: Number },
    /** Download cap in Mbps (internet → client). */
    speedDownMbps: { type: Number },
    /**
     * Which clock applies after activation:
     * - elapsed: wall-clock from first use (runs whether online or not)
     * - paused: online time only (MikroTik limit-uptime)
     */
    ticketDurationType: {
      type: String,
      enum: ['elapsed', 'paused'],
      default: 'elapsed',
    },
    /** Wall-clock seconds from first activation (elapsed time). */
    elapsedSeconds: { type: Number },
    /** Online-only seconds while connected (paused time → limit-uptime). */
    pausedSeconds: { type: Number },
    /** `pin` = same login/password; `user_pass` = separate username + password. */
    codeType: {
      type: String,
      enum: ['pin', 'user_pass'],
      default: 'pin',
    },
    pinLength: { type: Number, min: 4, max: 10, default: 8 },

    /** MikroTik PPP / hotspot profile names — not used for remote_access plans. */
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

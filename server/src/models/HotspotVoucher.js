import mongoose from 'mongoose';

const hotspotVoucherSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanPackage' },
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true },
    /** Login name (PIN or username). */
    code: { type: String, required: true },
    /** Password when codeType is user_pass; otherwise usually same as code. */
    password: { type: String },
    codeType: { type: String, enum: ['pin', 'user_pass'], default: 'pin' },
    profileName: { type: String, required: true },
    dataLimitBytes: { type: Number },
    /** Online-only time (paused) → MikroTik limit-uptime. */
    timeLimitSeconds: { type: Number },
    /** Wall-clock from first activation (elapsed). Applied to validUntil on first use. */
    elapsedSeconds: { type: Number },
    usersPerTicket: { type: Number, default: 1 },
    speedUpMbps: { type: Number },
    speedDownMbps: { type: Number },
    /** MikroTik /ip/hotspot server name this voucher is bound to. */
    hotspotServer: { type: String, trim: true, default: '' },
    validUntil: { type: Date },
    /** First time this code appeared in /ip/hotspot/active. */
    usedAt: { type: Date },
    /** MAC locked to this voucher after first activation (MikroTicket mc:). */
    lockedMac: { type: String, trim: true, default: '' },
    /** Last reconcile snapshot from MikroTik hotspot user / active. */
    lastSeenAt: { type: Date },
    bytesIn: { type: Number, default: 0 },
    bytesOut: { type: Number, default: 0 },
    mikrotikInternalId: { type: String },
  },
  { timestamps: true }
);

hotspotVoucherSchema.index({ validUntil: 1 });
hotspotVoucherSchema.index({ usedAt: 1 });
hotspotVoucherSchema.index({ routerId: 1, code: 1 }, { unique: true });

export const HotspotVoucher =
  mongoose.models.HotspotVoucher || mongoose.model('HotspotVoucher', hotspotVoucherSchema);

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
    code: { type: String, required: true },
    profileName: { type: String, required: true },
    dataLimitBytes: { type: Number },
    timeLimitSeconds: { type: Number },
    validUntil: { type: Date },
    usedAt: { type: Date },
    mikrotikInternalId: { type: String },
  },
  { timestamps: true }
);

hotspotVoucherSchema.index({ validUntil: 1 });
hotspotVoucherSchema.index({ routerId: 1, code: 1 }, { unique: true });

export const HotspotVoucher =
  mongoose.models.HotspotVoucher || mongoose.model('HotspotVoucher', hotspotVoucherSchema);

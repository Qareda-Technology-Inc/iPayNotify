import mongoose from 'mongoose';

/**
 * Remote access (non–PPPoE) subscription — monitored in billing for renewals and SMS notifications.
 * Phone is the primary contact for notifications (Arkesel / future channels).
 */
const remoteAccessSubscriptionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Shown when not linked to a billing User */
    displayName: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanPackage' },
    paidUntil: { type: Date, required: true },
    notes: { type: String, trim: true },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

remoteAccessSubscriptionSchema.index({ paidUntil: 1 });
remoteAccessSubscriptionSchema.index({ phone: 1 });
remoteAccessSubscriptionSchema.index({ userId: 1 });

export const RemoteAccessSubscription =
  mongoose.models.RemoteAccessSubscription ||
  mongoose.model('RemoteAccessSubscription', remoteAccessSubscriptionSchema);

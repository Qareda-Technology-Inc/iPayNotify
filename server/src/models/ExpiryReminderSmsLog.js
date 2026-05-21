import mongoose from 'mongoose';

/**
 * One row per successful 3-day (etc.) expiry reminder SMS for a billing line + period end.
 * Prevents duplicate sends while `paidUntil` is unchanged for that subscription.
 */
const expiryReminderSmsLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['pppoe', 'remote_access'],
      required: true,
    },
    billingId: { type: mongoose.Schema.Types.ObjectId, required: true },
    /** Same as PppoeAccount.paidUntil / RemoteAccessSubscription.paidUntil when the reminder was sent. */
    periodEnd: { type: Date, required: true },
    phone: { type: String, trim: true },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

expiryReminderSmsLogSchema.index({ kind: 1, billingId: 1, periodEnd: 1 }, { unique: true });

export const ExpiryReminderSmsLog =
  mongoose.models.ExpiryReminderSmsLog ||
  mongoose.model('ExpiryReminderSmsLog', expiryReminderSmsLogSchema);

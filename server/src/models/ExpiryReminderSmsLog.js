import mongoose from 'mongoose';

/**
 * One successful expiry-reminder SMS per billing line + period end + days-before tier
 * (e.g. 7d, 3d, 1d). Prevents duplicate sends while `paidUntil` is unchanged.
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
    /** Reminder tier in days before expiry (e.g. 7, 3, 1). */
    daysBefore: { type: Number, required: true, min: 1, max: 30 },
    phone: { type: String, trim: true },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

expiryReminderSmsLogSchema.index(
  { kind: 1, billingId: 1, periodEnd: 1, daysBefore: 1 },
  { unique: true }
);

export const ExpiryReminderSmsLog =
  mongoose.models.ExpiryReminderSmsLog ||
  mongoose.model('ExpiryReminderSmsLog', expiryReminderSmsLogSchema);

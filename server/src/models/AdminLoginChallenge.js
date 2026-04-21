import mongoose from 'mongoose';

const adminLoginChallengeSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    /** Single OTP; sent by email and/or SMS when multiple channels are used. */
    codeHash: { type: String, required: true },
    /** Which channels were used to deliver the code (client may show one or two hints). */
    sentEmail: { type: Boolean, default: false },
    sentSms: { type: Boolean, default: false },
    consumed: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

adminLoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminLoginChallenge =
  mongoose.models.AdminLoginChallenge ||
  mongoose.model('AdminLoginChallenge', adminLoginChallengeSchema);

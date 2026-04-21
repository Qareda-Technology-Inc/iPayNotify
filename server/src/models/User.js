import mongoose from 'mongoose';

/** Billing customer (not MikroTik system user). */
const userSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    email: { type: String, sparse: true, unique: true },
    phone: { type: String },
    fullName: { type: String },
    balanceCents: { type: Number, default: 0 },
    autoRenewalEnabled: { type: Boolean, default: false },
    paymentMethodRef: { type: String },
  },
  { timestamps: true }
);

userSchema.index({ phone: 1 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);

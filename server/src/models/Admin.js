import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    /** `super_admin` = platform; `org_admin` = dashboard for one organisation only. */
    role: {
      type: String,
      enum: ['super_admin', 'org_admin'],
      default: 'super_admin',
    },
    /** Required when role is `org_admin`; null for super admins. */
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    /** Ghana MSISDN-style (0XX… or 233…); used for admin login SMS verification when enabled. */
    phone: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

adminSchema.index({ organizationId: 1 });

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

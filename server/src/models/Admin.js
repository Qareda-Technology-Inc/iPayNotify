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
    /** Display name for tickets, notices, and the dashboard (required on new admins via API). */
    fullName: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true },
    /** `super_admin` = platform; `org_admin` = full org dashboard; `ticket_manager` = ticket sales + reports; `org_staff` = organisation staff access. */
    role: {
      type: String,
      enum: ['super_admin', 'org_admin', 'ticket_manager', 'org_staff'],
      default: 'super_admin',
    },
    /** Required when role is organisation-scoped (`org_admin` / `ticket_manager` / `org_staff`); null for super admins. */
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

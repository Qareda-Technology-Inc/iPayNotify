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
    /** Empty while status is `invited` (set on accept-invite). */
    passwordHash: { type: String, default: '' },
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
    /** `invited` until they accept the email link and set a password. */
    status: {
      type: String,
      enum: ['invited', 'active'],
      default: 'active',
    },
    inviteTokenHash: { type: String, default: '' },
    inviteExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

adminSchema.index({ organizationId: 1 });
adminSchema.index({ inviteTokenHash: 1 }, { sparse: true });

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

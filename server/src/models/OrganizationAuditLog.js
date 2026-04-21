import mongoose from 'mongoose';

/** Append-only tenant audit trail (organisation settings, billing, etc.). */
const organizationAuditLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    actorEmail: { type: String, trim: true, default: '' },
    action: { type: String, required: true, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'organization_audit_logs' }
);

organizationAuditLogSchema.index({ organizationId: 1, createdAt: -1 });

export const OrganizationAuditLog =
  mongoose.models.OrganizationAuditLog ||
  mongoose.model('OrganizationAuditLog', organizationAuditLogSchema);

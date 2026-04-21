import mongoose from 'mongoose';

export const MESSAGE_TEMPLATE_CATEGORIES = [
  'custom',
  'system_update',
  'maintenance',
  /** General renewal / expiry messaging */
  'expiry_notice',
  /** Pre-expiry: e.g. SMS ~3 days before service ends */
  'expiry_reminder_3d',
  /** Post-expiry: service already past due */
  'expiry_expired',
  'welcome_new_user',
  'emergency',
  'technical_issue',
];

const messageTemplateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: MESSAGE_TEMPLATE_CATEGORIES,
      required: true,
    },
    /** SMS body. Placeholders: {{brand}}, {{name}} */
    body: { type: String, required: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

messageTemplateSchema.index({ category: 1, isActive: 1 });
messageTemplateSchema.index({ name: 1 });

export const MessageTemplate =
  mongoose.models.MessageTemplate || mongoose.model('MessageTemplate', messageTemplateSchema);

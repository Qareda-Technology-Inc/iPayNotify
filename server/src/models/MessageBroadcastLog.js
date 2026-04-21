import mongoose from 'mongoose';

const messageBroadcastLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageTemplate' },
    templateName: { type: String },
    category: { type: String },
    /** Rendered sample (first recipient) or template snapshot */
    bodyPreview: { type: String },
    /** Send-time placeholders merged into the template (e.g. date, time_window) */
    templateVars: { type: mongoose.Schema.Types.Mixed },
    audiences: {
      pppoe: { type: Boolean, default: false },
      remote: { type: Boolean, default: false },
      hotspot: { type: Boolean, default: false },
    },
    /** audiences | user_ids | user_ids_filtered | manual_phones */
    recipientMode: { type: String, default: 'audiences' },
    intersectAudiences: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: false },
    recipientCount: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skippedNoPhone: { type: Number, default: 0 },
    failures: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** When set, only customers linked to this router (PPPoE / hotspot) were targeted; SMS used this site's brand/sender. */
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router' },
    smsBrandUsed: { type: String },
    smsSenderUsed: { type: String },
  },
  { timestamps: true }
);

messageBroadcastLogSchema.index({ createdAt: -1 });

export const MessageBroadcastLog =
  mongoose.models.MessageBroadcastLog ||
  mongoose.model('MessageBroadcastLog', messageBroadcastLogSchema);

import mongoose from 'mongoose';

const billingJobRunSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    jobName: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: false }
);

export const BillingJobRun =
  mongoose.models.BillingJobRun || mongoose.model('BillingJobRun', billingJobRunSchema);

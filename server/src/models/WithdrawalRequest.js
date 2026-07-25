import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    amountCents: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    destinationNote: { type: String, trim: true, default: '' },
    requestedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    processedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    processedAt: { type: Date },
    processNote: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

withdrawalRequestSchema.index({ organizationId: 1, createdAt: -1 });

export const WithdrawalRequest =
  mongoose.models.WithdrawalRequest ||
  mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

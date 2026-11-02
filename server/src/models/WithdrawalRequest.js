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
      /* pending: waits for a platform admin (holdReason says why). processing: sent to the vendor's
       * MoMo, waiting for Paystack's result. A failed transfer goes back to pending. */
      enum: ['pending', 'approved', 'processing', 'paid', 'rejected', 'cancelled'],
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
    /** auto: sent by the system within the limits; manual: a platform admin decided. */
    payoutMethod: { type: String, enum: ['auto', 'manual', ''], default: '' },
    /** Why it waits for approval instead of paying straight away. */
    holdReason: { type: String, trim: true, default: '' },
    /** MoMo number the money goes (or went) to. */
    payoutMsisdn: { type: String, trim: true, default: '' },
    /** Paystack transfer reference of the latest attempt (one per attempt). */
    transferReference: { type: String, trim: true, default: '' },
    transferAttempts: { type: Number, default: 0 },
    failureReason: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

withdrawalRequestSchema.index({ organizationId: 1, createdAt: -1 });
withdrawalRequestSchema.index({ transferReference: 1 }, { sparse: true });

export const WithdrawalRequest =
  mongoose.models.WithdrawalRequest ||
  mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

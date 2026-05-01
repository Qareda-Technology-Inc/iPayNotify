import mongoose from 'mongoose';

const ticketTypeSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketSite',
      required: true,
      index: true,
    },
    label: { type: String, required: true, trim: true },
    durationDays: { type: Number, required: true, min: 1 },
    priceCents: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ticketTypeSchema.index({ organizationId: 1, siteId: 1, active: 1 });

export const TicketType = mongoose.models.TicketType || mongoose.model('TicketType', ticketTypeSchema);

import mongoose from 'mongoose';

const ticketSiteSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    /** Hotspot router whose printed tickets this site's sellers receive (linked issues). */
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: null },
  },
  { timestamps: true }
);

ticketSiteSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const TicketSite = mongoose.models.TicketSite || mongoose.model('TicketSite', ticketSiteSchema);

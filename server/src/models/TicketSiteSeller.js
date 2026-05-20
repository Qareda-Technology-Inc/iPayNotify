import mongoose from 'mongoose';

/**
 * Receiver / seller person registered for a ticket site (many per site).
 * Ticket sales may reference `ticketSiteSellerId` while denormalizing `sellerName` for history and queries.
 */
const ticketSiteSellerSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketSite',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    /** Lowercased name for uniqueness within a site (set in pre-validate). */
    nameLower: { type: String, trim: true, default: '' },
    /** Ghana-style mobile for SMS; stored as entered, normalized when sending. */
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

ticketSiteSellerSchema.pre('validate', function setNameLower(next) {
  this.name = String(this.name || '').trim();
  this.nameLower = this.name.toLowerCase();
  next();
});

ticketSiteSellerSchema.index({ siteId: 1, nameLower: 1 }, { unique: true });

export const TicketSiteSeller =
  mongoose.models.TicketSiteSeller || mongoose.model('TicketSiteSeller', ticketSiteSellerSchema);

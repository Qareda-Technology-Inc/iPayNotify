import mongoose from 'mongoose';

const ticketSaleSchema = new mongoose.Schema(
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
    ticketTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketType',
      index: true,
    },
    kind: {
      type: String,
      enum: ['issued', 'collected'],
      required: true,
      default: 'issued',
      index: true,
    },
    sellerName: { type: String, required: true, trim: true, index: true },
    /** When set, links to TicketSiteSeller for this site (sellerName is still denormalised for reports). */
    ticketSiteSellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketSiteSeller',
      index: true,
      default: null,
    },
    /** Receiver/seller Ghana mobile for SMS alerts (stored as entered; normalized when sending). */
    sellerPhone: { type: String, trim: true, default: '' },
    issueSaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketSale',
      index: true,
    },
    sellerAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    amountCents: { type: Number, required: true, min: 0 },
    /** Cash collection only: physical payer when not the seller (agent/messenger). */
    receivedFromName: { type: String, trim: true, default: '' },
    /** Optional mobile for messenger when handing over cash (Ghana digits). */
    receivedFromPhone: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    soldAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

ticketSaleSchema.index({ organizationId: 1, soldAt: -1 });
ticketSaleSchema.index({ organizationId: 1, siteId: 1, sellerName: 1, soldAt: -1 });

export const TicketSale = mongoose.models.TicketSale || mongoose.model('TicketSale', ticketSaleSchema);

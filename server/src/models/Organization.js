import mongoose from 'mongoose';

const organizationBillingSchema = new mongoose.Schema(
  {
    /** Shown on checkout description / draft UI when set. */
    merchantDisplayName: { type: String, trim: true, default: '' },
    /** Default SMS "brand" line when a router has no `smsBrandName`. */
    smsBrandName: { type: String, trim: true, default: '' },
    /**
     * Optional per-org take-rate in basis points (500 = 5%).
     * Null → platform default from PlatformSettings in the database.
     */
    platformFeeBps: { type: Number, default: null },
    /** Optional MoMo / bank hint for super-admin payouts. */
    payoutMomoNumber: { type: String, trim: true, default: '' },
    payoutNote: { type: String, trim: true, default: '' },
    /** Public HTTPS URL for portal / checkout logo (optional white-label). */
    logoUrl: { type: String, trim: true, default: '' },
    /** Captive login template id (see services/captiveTemplates.js). */
    portalDesign: { type: String, trim: true, default: 'midnight' },
    /** Ticket PDF design id (see utils/portalDesigns.js VOUCHER_DESIGN_IDS). */
    voucherDesign: { type: String, trim: true, default: 'grid' },
    /** Optional login copy. Empty uses the selected design's default wording. */
    portalHeadline: { type: String, trim: true, default: '' },
    portalSubtitle: { type: String, trim: true, default: '' },
    portalButtonLabel: { type: String, trim: true, default: '' },
    portalBuyLabel: { type: String, trim: true, default: '' },
    /** Footer line on the login page (e.g. opening hours, address). */
    portalFooter: { type: String, trim: true, default: '' },
    /** Help line shown in the login page footer as a tap-to-call link. */
    portalSupportPhone: { type: String, trim: true, default: '' },
    /** List active hotspot plans with prices on the login page. */
    portalShowPlans: { type: Boolean, default: true },
    /** Optional title on printed vouchers. Empty uses "Wi‑Fi Access". */
    voucherTitle: { type: String, trim: true, default: '' },
    /** Tickets per A4 sheet: `auto` (design's own size) or `<columns>x<rows>`, e.g. `8x5`. */
    voucherSheet: { type: String, trim: true, default: 'auto' },
  },
  { _id: false }
);

/** Optional product modules — enabled per tenant by super admin. */
const organizationModulesSchema = new mongoose.Schema(
  {
    /** Ticket sales / collections / reports */
    tickets: { type: Boolean, default: false },
    /** Remote-access subscriptions (non-PPPoE) */
    remoteAccess: { type: Boolean, default: false },
  },
  { _id: false }
);

/** Soft caps — null means unlimited. Enforced on create/send. */
const organizationLimitsSchema = new mongoose.Schema(
  {
    maxRouters: { type: Number, default: null },
    maxAdmins: { type: Number, default: null },
    maxSmsPerMonth: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * What the organisation pays the platform each month (on top of the per-sale fee):
 * orgFeeCents + routerFeeCents × routers. Paid by Hubtel; `paidUntil` moves forward per month paid.
 * When `enabled`, status follows it: active → past_due after paidUntil → suspended after graceDays.
 */
const organizationPlatformBillingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    orgFeeCents: { type: Number, default: 0, min: 0 },
    routerFeeCents: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'GHS' },
    graceDays: { type: Number, default: 7, min: 0, max: 90 },
    paidUntil: { type: Date, default: null },
    /** Last reminder sent, so each notice goes out once per due date. */
    lastNotice: {
      kind: { type: String, default: '' },
      forPaidUntil: { type: Date, default: null },
      at: { type: Date, default: null },
    },
  },
  { _id: false }
);

/** SaaS tenant — routers, customers, and billing data belong to one organization. */
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /** URL-safe handle; unique across the platform. */
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    status: {
      type: String,
      enum: ['active', 'trial', 'past_due', 'suspended'],
      default: 'active',
    },
    /** Why status is not active: set by platform billing ('unpaid') or by a super admin ('manual'). */
    statusReason: { type: String, enum: ['', 'manual', 'unpaid'], default: '' },
    billing: { type: organizationBillingSchema, default: () => ({}) },
    platformBilling: { type: organizationPlatformBillingSchema, default: () => ({}) },
    modules: { type: organizationModulesSchema, default: () => ({}) },
    limits: { type: organizationLimitsSchema, default: () => ({}) },
    /** Cached available wallet balance (cents). Updated with each ledger entry. */
    walletBalanceCents: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', organizationSchema);

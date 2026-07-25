import mongoose from 'mongoose';

const organizationBillingSchema = new mongoose.Schema(
  {
    /** Shown on checkout description / draft UI when set. */
    merchantDisplayName: { type: String, trim: true, default: '' },
    /** Default SMS "brand" line when a router has no `smsBrandName`. */
    smsBrandName: { type: String, trim: true, default: '' },
    /**
     * @deprecated Platform Hubtel always collects. Kept for legacy docs only.
     */
    useCustomHubtel: { type: Boolean, default: false },
    hubtelMerchantAccount: { type: String, default: '' },
    hubtelClientId: { type: String, default: '' },
    hubtelClientSecret: { type: String, default: '' },
    hubtelCallbackUrl: { type: String, default: '' },
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
    billing: { type: organizationBillingSchema, default: () => ({}) },
    modules: { type: organizationModulesSchema, default: () => ({}) },
    limits: { type: organizationLimitsSchema, default: () => ({}) },
    /** Cached available wallet balance (cents). Updated with each ledger entry. */
    walletBalanceCents: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', organizationSchema);

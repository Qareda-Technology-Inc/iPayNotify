import mongoose from 'mongoose';

const organizationBillingSchema = new mongoose.Schema(
  {
    /** Shown on checkout description / draft UI when set. */
    merchantDisplayName: { type: String, trim: true, default: '' },
    /** Default SMS "brand" line when a router has no `smsBrandName`. */
    smsBrandName: { type: String, trim: true, default: '' },
    /** When true, Hubtel credentials below replace platform env. */
    useCustomHubtel: { type: Boolean, default: false },
    hubtelMerchantAccount: { type: String, default: '' },
    hubtelClientId: { type: String, default: '' },
    hubtelClientSecret: { type: String, default: '' },
    hubtelCallbackUrl: { type: String, default: '' },
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
  },
  { timestamps: true }
);

export const Organization =
  mongoose.models.Organization || mongoose.model('Organization', organizationSchema);

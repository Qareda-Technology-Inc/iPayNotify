import mongoose from 'mongoose';

const organizationBillingSchema = new mongoose.Schema(
  {
    /** Shown on MTN request-to-pay payee note and draft checkout when set. */
    merchantDisplayName: { type: String, trim: true, default: '' },
    /** Default SMS "brand" line when a router has no `smsBrandName`. */
    smsBrandName: { type: String, trim: true, default: '' },
    /** When true, MTN Collections credentials below replace platform env (same callback server). */
    useCustomMomo: { type: Boolean, default: false },
    mtnMomoSubscriptionKey: { type: String, default: '' },
    mtnMomoApiUser: { type: String, default: '' },
    mtnMomoApiKey: { type: String, default: '' },
    mtnMomoBaseUrl: { type: String, default: '' },
    mtnMomoTargetEnvironment: { type: String, default: '' },
    mtnMomoCallbackUrl: { type: String, default: '' },
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

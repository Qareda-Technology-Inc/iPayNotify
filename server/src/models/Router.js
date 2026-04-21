import mongoose from 'mongoose';

const routerSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    name: { type: String, required: true },
    /** Customer-facing / admin label (router name in lists and portal). If set, overrides `name` for display. */
    comment: { type: String, trim: true, default: '' },
    host: { type: String, required: true },
    /** `api` = RouterOS API (8728). `ssh` = exec same CLI as Winbox terminal (default 22). */
    transport: { type: String, enum: ['api', 'ssh'], default: 'ssh' },
    apiPort: { type: Number, default: 8728 },
    sshPort: { type: Number, default: 22 },
    /** If empty, SSH uses apiUser / apiPassword. */
    sshUser: { type: String, default: '' },
    sshPassword: { type: String, default: '', select: false },
    apiUser: { type: String, required: true },
    apiPassword: { type: String, required: true },
    defaultPppProfile: { type: String, default: 'default' },
    expiredPppProfile: { type: String, default: 'nonpayment' },
    /**
     * WAN IPv4 your billing API sees when a user on this site's hotspot opens the portal
     * (same source IP for everyone behind that router's masquerade). Nettportal-style auto-pick.
     */
    sitePublicIp: { type: String, trim: true, sparse: true, unique: true },
    /** Captive link segment: /portal/hotspot?r=your-slug (unique, lowercase). */
    portalSlug: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
    /** SMS prefix in {{brand}} / payment texts for this site (falls back to global SMS_BRAND_NAME). */
    smsBrandName: { type: String, trim: true, default: '' },
    /** Optional Arkesel sender ID for this router (must be registered in Arkesel); empty = use global ARKESEL_SENDER_ID. */
    smsSenderId: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

routerSchema.index({ host: 1, apiPort: 1 });

export const Router = mongoose.models.Router || mongoose.model('Router', routerSchema);

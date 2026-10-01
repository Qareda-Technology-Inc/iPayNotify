import mongoose from 'mongoose';

/**
 * WireGuard VPN peer registry (VPS wg0 ↔ MikroTik routers + phone/laptop clients).
 * Named WireGuardPeer so it does not collide with the existing MikroTik `Router` inventory model.
 */
const wireGuardPeerSchema = new mongoose.Schema(
  {
    siteName: { type: String, required: true, trim: true },
    /** WireGuard public key (base64), unique */
    publicKey: { type: String, required: true, trim: true, unique: true },
    /** Tunnel address in configured pool (default 10.66.54.0/24), e.g. 10.66.54.5 */
    tunnelIp: { type: String, required: true, trim: true, unique: true },
    /** Optional LAN CIDR behind the router, e.g. 192.168.88.0/24 */
    lanSubnet: { type: String, trim: true, default: '' },
    /** Org that downloaded the install script / owns this peer (router self-register) */
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    /** When linked to a billing MikroTik Router row */
    claimedRouterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Router',
      default: null,
      index: true,
    },
    /** router = site MikroTik; client = phone/laptop admin access */
    kind: {
      type: String,
      enum: ['router', 'client'],
      default: 'router',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'disabled', 'error'],
      default: 'active',
      index: true,
    },
    /** Why the peer is disabled. Only `subscription_expired` is lifted automatically on renewal. */
    disabledReason: {
      type: String,
      enum: ['', 'manual', 'subscription_expired'],
      default: '',
    },
    lastSeen: { type: Date, default: Date.now },
    /** Last sync error from `wg set` on the VPS (if any) */
    lastSyncError: { type: String, default: '' },
  },
  { timestamps: true }
);

wireGuardPeerSchema.index({ createdAt: -1 });
wireGuardPeerSchema.index({ organizationId: 1, claimedRouterId: 1 });

export const WireGuardPeer = mongoose.model('WireGuardPeer', wireGuardPeerSchema);

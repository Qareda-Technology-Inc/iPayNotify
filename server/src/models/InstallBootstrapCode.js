import mongoose from 'mongoose';
import crypto from 'node:crypto';

const installBootstrapCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    siteName: { type: String, default: '' },
    lanSubnet: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

installBootstrapCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const InstallBootstrapCode = mongoose.model(
  'InstallBootstrapCode',
  installBootstrapCodeSchema
);

/** Short alphanumeric code safe for MikroTik /tool fetch URLs (no special chars). */
export function newBootstrapCode() {
  return crypto.randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
}

import { PlatformSettings } from '../models/index.js';

const FALLBACK_FEE_BPS = 500;

function clampFeeBps(n) {
  return Math.max(0, Math.min(10_000, Math.round(Number(n))));
}

/** Ensure the singleton settings row exists. */
export async function ensurePlatformSettings() {
  let doc = await PlatformSettings.findOne({ key: 'default' });
  if (!doc) {
    doc = await PlatformSettings.create({
      key: 'default',
      defaultPlatformFeeBps: FALLBACK_FEE_BPS,
    });
  }
  return doc;
}

export async function getDefaultPlatformFeeBps() {
  const doc = await ensurePlatformSettings();
  const n = Number(doc.defaultPlatformFeeBps);
  if (!Number.isFinite(n)) return FALLBACK_FEE_BPS;
  return clampFeeBps(n);
}

/**
 * Resolve fee for an org: org override → platform DB default.
 * @param {{ platformFeeBps?: number|null }|null|undefined} orgBilling
 */
export async function resolvePlatformFeeBps(orgBilling) {
  const override = orgBilling?.platformFeeBps;
  if (override != null && Number.isFinite(Number(override))) {
    return clampFeeBps(override);
  }
  return getDefaultPlatformFeeBps();
}

export async function updateDefaultPlatformFeeBps(feeBps) {
  const n = clampFeeBps(feeBps);
  if (!Number.isFinite(Number(feeBps)) || Number(feeBps) < 0 || Number(feeBps) > 10_000) {
    const e = new Error('defaultPlatformFeeBps must be 0–10000 (basis points)');
    e.status = 400;
    throw e;
  }
  const doc = await PlatformSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { defaultPlatformFeeBps: n } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

export async function getPlatformSettingsPublic() {
  const doc = await ensurePlatformSettings();
  const bps = clampFeeBps(doc.defaultPlatformFeeBps);
  return {
    defaultPlatformFeeBps: bps,
    defaultPlatformFeePercent: bps / 100,
    updatedAt: doc.updatedAt,
  };
}
